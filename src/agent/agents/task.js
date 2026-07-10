import { randomUUID } from 'crypto';
import { executeTool, getToolDocs, getToolDefinitions } from '../commands/index.js';
import { CodeAgent, getAugment } from './code.js';
import { createLogger } from '../../utils/logger.js';
import settings from '../settings.js';

const log = createLogger('TaskAgent');
const DEFAULT_MAX_STEPS = 50;
const DEFAULT_MAX_NO_TOOL_STREAK = 3;
const DEFAULT_MAX_MODEL_FAILURES = 3;

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function shortText(value, maxLength = 500) {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    const cleaned = text.replace(/\s+/g, ' ').trim();
    return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 3)}...` : cleaned;
}

function normalizeArguments(args) {
    if (!args)
        return {};
    if (typeof args === 'string') {
        try {
            return JSON.parse(args);
        } catch {
            return {};
        }
    }
    return args;
}

export class TaskAgent {
    constructor(agent, messageQueue) {
        this.agent = agent;
        this.messageQueue = messageQueue;
        this.is_running = false;
        this.cancelJob = false;
        this.currentTaskDescription = null;
        this.currentStep = 0;
        this.currentTaskId = null;
        this.currentSystemPrompt = '';
        this.currentHistory = [];
        this.currentSource = 'system';
    }

    async performTask(taskDescription, systemPrompt, options = {}) {
        if (this.is_running)
            throw new Error('TaskAgent is already running a task.');

        const resumeState = options.resumeState || null;
        const maxSteps = Number(settings.task_max_steps) || DEFAULT_MAX_STEPS;
        const maxNoToolStreak = Number(settings.task_max_no_tool_streak) || DEFAULT_MAX_NO_TOOL_STREAK;
        const maxModelFailures = Number(settings.task_max_model_failures) || DEFAULT_MAX_MODEL_FAILURES;

        this.is_running = true;
        this.cancelJob = false;
        this.currentTaskDescription = taskDescription;
        this.currentSystemPrompt = systemPrompt || '';
        this.currentSource = options.source || resumeState?.source || 'system';
        this.currentTaskId = resumeState?.id || randomUUID();
        this.currentStep = Number(resumeState?.step) || 0;

        let history;
        let noToolStreak = Number(resumeState?.no_tool_streak) || 0;
        let modelFailureStreak = 0;
        let lastParsed = resumeState?.last_parsed || null;
        const startedAt = resumeState?.started_at || new Date().toISOString();

        if (resumeState?.history?.length) {
            history = clone(resumeState.history);
            history.push({
                role: 'user',
                content: '[System recovery]: The agent process restarted. Re-check current game state before continuing; do not assume the interrupted action completed.'
            });
            this.agent.progress?.report?.(`Recovered task: ${taskDescription}`, { force: true });
            this.agent.stateStore?.remember('recovery', `Resuming task at step ${this.currentStep}: ${taskDescription}`);
        } else {
            history = await this._buildInitialHistory(taskDescription, systemPrompt);
            this.agent.progress?.report?.(`Starting task: ${taskDescription}`, { force: true });
            this.agent.stateStore?.remember('task_start', taskDescription, { task_id: this.currentTaskId });
        }

        this.currentHistory = history;
        this._checkpoint(history, noToolStreak, lastParsed, startedAt);
        log.info(`${resumeState ? 'Resuming' : 'Starting'}: ${taskDescription}`);

        try {
            while (this.currentStep < maxSteps && !this.cancelJob) {
                if (this.messageQueue?.hasItems()) {
                    const items = this.messageQueue.drain();
                    for (const item of items) {
                        if (item.type === 'cancel') {
                            log.info('Cancel request from brain.');
                            this.cancelJob = true;
                            break;
                        }
                        if (item.type === 'context') {
                            log.info(`Brain update from ${item.source}: ${item.message}`);
                            history.push({
                                role: 'user',
                                content: `[Brain Update from ${item.source}]: ${item.message}`
                            });
                            this.agent.stateStore?.remember('task_update', `${item.source}: ${item.message}`);
                        }
                    }
                    if (this.cancelJob)
                        break;
                }

                this.currentStep++;
                log.info(`Step ${this.currentStep}/${maxSteps}`);
                this._checkpoint(history, noToolStreak, lastParsed, startedAt);

                let response;
                let toolCalls;
                let modelMetadata;
                const stopThinking = this.agent.progress?.startThinking?.(
                    `${this.currentTaskDescription} (step ${this.currentStep})`
                ) || (() => {});
                try {
                    [response, toolCalls, modelMetadata] = await this.agent.prompter.chat_model.sendRequest(
                        history, null, getToolDefinitions(this.agent), null
                    );
                    modelFailureStreak = 0;
                } catch (error) {
                    modelFailureStreak++;
                    log.error(`LLM call failed at step ${this.currentStep}:`, error);
                    this.agent.stateStore?.remember('model_error', shortText(error.message), {
                        task_id: this.currentTaskId,
                        step: this.currentStep
                    });
                    history.push({
                        role: 'user',
                        content: `[System error]: The model request failed: ${error.message}. Reassess and try again.`
                    });
                    this._checkpoint(history, noToolStreak, lastParsed, startedAt);
                    if (modelFailureStreak >= maxModelFailures) {
                        return this._finish('failed', {
                            chat_response: `Task paused after ${modelFailureStreak} consecutive model errors. It can resume after restart or a new request.`,
                            steps: this.currentStep,
                            work_done: false
                        });
                    }
                    continue;
                } finally {
                    stopThinking();
                }

                const calls = Array.isArray(toolCalls) ? toolCalls : [];
                const assistantMessage = modelMetadata?.assistant_message;
                history.push(assistantMessage
                    ? clone(assistantMessage)
                    : { role: 'assistant', content: response || '' });

                const parsed = this._parseResponse(response);
                if (parsed) {
                    lastParsed = parsed;
                    log.debug(`Private task thought: ${parsed.thought || ''}`);
                    if (parsed.step_report)
                        log.info(`Report: ${parsed.step_report}`);
                    const publicUpdate = parsed.progress_update || parsed.step_report;
                    if (publicUpdate) {
                        this.agent.progress?.report?.(publicUpdate);
                        this.agent.stateStore?.remember('task_progress', publicUpdate, {
                            task_id: this.currentTaskId,
                            step: this.currentStep
                        });
                    }
                }

                if (calls.length > 0) {
                    noToolStreak = 0;
                    const execution = await this._executeToolCalls(calls);
                    if (execution.toolMessages.length === calls.length && calls.every(call => call.id))
                        history.push(...execution.toolMessages);
                    else
                        history.push({ role: 'user', content: `[Tool Results]:\n${execution.text}` });

                    if (parsed?.work_done) {
                        history.push({
                            role: 'user',
                            content: '[System]: Tool calls just ran. Verify their results before declaring the task complete.'
                        });
                    }
                } else {
                    noToolStreak++;
                    log.info(`No tool calls (streak: ${noToolStreak}/${maxNoToolStreak})`);
                }

                history = this._trimHistory(history);
                this.currentHistory = history;
                this._checkpoint(history, noToolStreak, lastParsed, startedAt);

                if (parsed?.work_done && calls.length === 0) {
                    return this._finish('completed', {
                        chat_response: parsed.chat_response || parsed.progress_update || parsed.step_report || 'Task done.',
                        steps: this.currentStep,
                        work_done: true
                    });
                }

                if (calls.length === 0) {
                    if (noToolStreak >= maxNoToolStreak) {
                        return this._finish('stalled', {
                            chat_response: 'I could not make further tool-based progress. The task checkpoint was saved.',
                            steps: this.currentStep,
                            work_done: false
                        });
                    }
                    history.push({
                        role: 'user',
                        content: '[System]: No tools were called. Invoke a tool for the next concrete action, or set work_done=true only if the task is verifiably complete.'
                    });
                }
            }

            const status = this.cancelJob ? 'cancelled' : 'step_limit';
            return this._finish(status, {
                chat_response: this.cancelJob
                    ? 'Task cancelled.'
                    : `Task checkpoint saved after reaching the ${maxSteps}-step limit.`,
                steps: this.currentStep,
                work_done: false
            });
        } catch (error) {
            log.error('Unexpected task failure:', error);
            return this._finish('failed', {
                chat_response: `Task failed unexpectedly: ${error.message}`,
                steps: this.currentStep,
                work_done: false
            });
        }
    }

    async _buildInitialHistory(taskDescription, systemPrompt) {
        let taskHeader = '';
        const headerTemplate = this.agent.prompter?.profile?.task_agent;
        if (headerTemplate) {
            taskHeader = await this.agent.prompter.replaceStrings(
                headerTemplate, [{ role: 'user', content: taskDescription }]
            );
            taskHeader += '\n\n';
        }

        const memory = this.agent.stateStore?.getMemoryContext(
            Number(settings.persistent_memory_context_events) || 12
        ) || 'No persistent memory.';
        const fullPrompt = `${taskHeader}${systemPrompt || ''}\n\nTask: ${taskDescription}\n\n` +
            `[Recent persistent memory]\n${memory}\n\n${getToolDocs(this.agent)}\n\n` +
            'Use native function calls for actions. After observations or tool results, return JSON like ' +
            '{"thought":"private concise analysis","progress_update":"short public status","step_report":"verified result","work_done":false}. ' +
            'Never put hidden chain-of-thought in progress_update. Include chat_response only when the bounded task is complete.';
        return [{ role: 'system', content: fullPrompt }];
    }

    cancelTask() {
        this.cancelJob = true;
        this.agent.requestInterrupt?.();
        this._checkpoint(this.currentHistory, 0, null, null);
        log.info('Cancellation requested.');
    }

    _checkpoint(history, noToolStreak, lastParsed, startedAt) {
        if (!this.is_running || !this.currentTaskId)
            return;
        this.agent.stateStore?.saveTask({
            id: this.currentTaskId,
            status: 'running',
            description: this.currentTaskDescription,
            system_prompt: this.currentSystemPrompt,
            source: this.currentSource,
            step: this.currentStep,
            no_tool_streak: noToolStreak,
            last_parsed: clone(lastParsed),
            history: clone(history || []),
            started_at: startedAt || new Date().toISOString()
        });
    }

    _trimHistory(history) {
        const max = Number(settings.task_context_messages) || 40;
        if (!Array.isArray(history) || history.length <= max)
            return history;
        const systemMessage = history.find(message => message.role === 'system');
        const recent = history.slice(-(max - (systemMessage ? 1 : 0)));
        while (recent[0]?.role === 'tool')
            recent.shift();
        return systemMessage ? [systemMessage, ...recent] : recent;
    }

    _finish(status, result) {
        log.info(`Task ${status} after ${result.steps} steps.`);
        this.agent.stateStore?.finishTask(status, result);
        this.agent.stateStore?.remember('task_finish', `${status}: ${result.chat_response}`, {
            task_id: this.currentTaskId,
            work_done: result.work_done
        });
        this.is_running = false;
        this.cancelJob = false;
        this.currentTaskDescription = null;
        this.currentSystemPrompt = '';
        this.currentStep = 0;
        this.currentTaskId = null;
        this.currentHistory = [];
        return result;
    }

    async _executeToolCalls(toolCalls) {
        const results = [];
        const toolMessages = [];

        for (const originalCall of toolCalls) {
            const call = { ...originalCall, arguments: normalizeArguments(originalCall.arguments) };
            if (!call.name) {
                results.push('Error: Tool call missing name');
                continue;
            }

            this.agent.progress?.tool?.(call);
            this.agent.stateStore?.remember('tool_call', `${call.name} ${shortText(call.arguments, 250)}`, {
                task_id: this.currentTaskId,
                step: this.currentStep
            });
            log.info(`Calling tool: ${call.name}`);

            let output;
            try {
                const result = await executeTool(this.agent, call.name, call.arguments);
                output = result || 'Success (no output)';
                log.info(`${call.name} -> ${shortText(output)}`);
            } catch (error) {
                if (error.message.includes('not found')) {
                    const augmentResult = await this._tryAugment(call);
                    if (augmentResult !== null)
                        output = augmentResult || 'Success (no output)';
                }
                if (output === undefined) {
                    output = `Error - ${error.message}`;
                    log.error(`${call.name} failed:`, error.message);
                    this.agent.progress?.report?.(`${call.name} failed: ${shortText(error.message, 70)}`);
                }
            }

            const outputText = typeof output === 'string' ? output : JSON.stringify(output);
            results.push(`${call.name}: ${outputText}`);
            this.agent.stateStore?.remember('tool_result', `${call.name}: ${shortText(outputText)}`, {
                task_id: this.currentTaskId,
                step: this.currentStep
            });
            if (call.id) {
                toolMessages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: outputText
                });
            }
        }

        return { text: results.join('\n'), toolMessages };
    }

    async _tryAugment(call) {
        const augment = getAugment(call.name);
        if (!augment)
            return null;

        log.info(`Using augment: ${call.name}`);
        try {
            const args = call.arguments || {};
            const positionalArgs = Array.isArray(augment.parameters)
                ? augment.parameters.map(parameter => args[parameter.name])
                : [];
            return await augment.execute(this.agent, ...positionalArgs);
        } catch (error) {
            log.error(`Augment ${call.name} failed:`, error.message);
            return `Error: ${error.message}`;
        }
    }

    async requestAugment(spec) {
        const codeAgent = new CodeAgent(this.agent);
        try {
            const tool = await codeAgent.generateAugment(spec);
            return tool ? `Augment ${spec.augment_name} ready.` : `Failed to generate ${spec.augment_name}.`;
        } catch (error) {
            return `Augment error: ${error.message}`;
        }
    }

    _parseResponse(response) {
        if (typeof response !== 'string' || !response.trim())
            return null;

        let clean = response.trim();
        if (clean.startsWith('```json'))
            clean = clean.slice(7);
        else if (clean.startsWith('```'))
            clean = clean.slice(3);
        if (clean.endsWith('```'))
            clean = clean.slice(0, -3);
        const start = clean.indexOf('{');
        const end = clean.lastIndexOf('}');
        if (start >= 0 && end > start)
            clean = clean.slice(start, end + 1);
        try {
            return JSON.parse(clean);
        } catch {
            return null;
        }
    }
}
