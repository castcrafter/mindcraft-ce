import { Goals, checklistItem } from '../goals/goals.js';
import { brainAgentResponseFormat } from './responseFormat.js';
import settings from '../settings.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('BrainAgent');
const MAX_BRAIN_HISTORY = 20;

function shortText(value, maxLength = 500) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function reasoningForLog(value) {
    const text = String(value ?? '').trim();
    const configured = Number(settings.log_model_reasoning_max_chars);
    const maxLength = Number.isFinite(configured) && configured > 0 ? configured : 12000;
    return text.length > maxLength ? `${text.slice(0, maxLength)}\n...[reasoning truncated]` : text;
}

export class BrainAgent {
    constructor(agent, messageQueue) {
        this.agent = agent;
        this.messageQueue = messageQueue;

        const saved = agent.stateStore?.snapshot?.() || {};
        this.goals = Goals.fromJSON(saved.goals || []);
        this.active_goal = saved.active_goal || null;
        this.message_history = Array.isArray(saved.brain_history) ? saved.brain_history : [];
        this.autonomy = {
            enabled: false,
            paused: false,
            consecutive_failures: 0,
            ...(saved.autonomy || {})
        };
        this._processing = false;
        this._ensureActiveGoal();
        this._persist();
    }

    async processRequest(source, message) {
        if (!source || !message || source === this.agent.name)
            return null;

        if (this._processing) {
            log.warn(`Brain is already processing a request from ${source}.`);
            return { route: 'queued', thoughts: 'Brain is busy.' };
        }

        this._processing = true;
        const stopThinking = this.agent.progress?.startThinking?.(shortText(message, 75)) || (() => {});

        try {
            log.info(`Request from ${source}: ${message}`);
            this.agent.stateStore?.remember(
                source === 'system' ? 'system' : 'request',
                `${source}: ${shortText(message)}`
            );
            this._appendUserMessage(source, message);

            let response;
            let modelMetadata;
            try {
                [response, , modelMetadata] = await this.agent.prompter.handleRequest(
                    'brain', this.message_history, [], brainAgentResponseFormat
                );
            } catch (error) {
                log.error('LLM request failed:', error);
                return null;
            }

            const parsed = this._parseResponse(response);
            if (!parsed) {
                log.error('Failed to parse brain JSON:', response);
                return null;
            }

            this.message_history.push({ role: 'assistant', content: JSON.stringify(parsed) });
            this._trimHistory();

            log.info(`Route: ${parsed.route}`);
            log.debug(`Private model analysis: ${parsed.thoughts || ''}`);
            const providerReasoning = modelMetadata?.assistant_message?.reasoning_content;
            if (settings.log_model_reasoning && providerReasoning)
                log.info(`Provider reasoning:\n${reasoningForLog(providerReasoning)}`);

            const goalActions = Array.isArray(parsed.goal_action)
                ? parsed.goal_action
                : parsed.goal_action ? [parsed.goal_action] : [];
            for (const goalAction of goalActions)
                this._handleGoalAction(goalAction);

            const publicUpdate = shortText(parsed.progress_update || parsed.task_description, 110);
            if (publicUpdate) {
                if (this.agent.progress?.decision)
                    this.agent.progress.decision({ progress_update: publicUpdate });
                else
                    this.agent.progress?.plan?.(publicUpdate);
            }

            this.agent.stateStore?.remember(
                'decision',
                publicUpdate || `Routed request to ${parsed.route || 'rp'}`,
                { route: parsed.route || 'rp' }
            );
            this._persist();

            if (parsed.route === 'task') {
                const fallbackDescription = String(parsed.thoughts || 'Continue the active goal')
                    .split(/[.!?\n]/)[0].trim();
                const taskDescription = parsed.task_description || fallbackDescription;
                const taskSystemPrompt = parsed.task_system_prompt || '';
                const taskAction = parsed.task_action || 'start';
                log.info(`Task: ${taskDescription} (action: ${taskAction})`);
                return {
                    route: 'task',
                    thoughts: parsed.thoughts || '',
                    progress_update: publicUpdate,
                    task_description: taskDescription,
                    task_system_prompt: taskSystemPrompt,
                    task_action: taskAction
                };
            }

            return {
                route: 'rp',
                thoughts: parsed.thoughts || '',
                progress_update: publicUpdate
            };
        } finally {
            stopThinking();
            this._processing = false;
        }
    }

    recordTaskOutcome(result) {
        const successful = Boolean(result?.work_done);
        const outcome = result
            ? `[Task ${successful ? 'completed' : 'stopped'} in ${result.steps || '?'} steps]: ${result.chat_response || 'No report.'}`
            : '[Task failed without a result]';
        this.message_history.push({ role: 'user', content: outcome });
        this._trimHistory();

        this.autonomy.consecutive_failures = successful
            ? 0
            : Number(this.autonomy.consecutive_failures || 0) + 1;
        this.agent.stateStore?.remember('task_outcome', outcome, { successful });
        this._persist();
    }

    setPrimaryGoal(name, description = '', priority = 100, checklist = []) {
        const goal = this.goals.addGoal(name, description || name, priority, checklist);
        if (!goal)
            return null;
        this.active_goal = goal.name;
        this.autonomy.enabled = true;
        this.autonomy.paused = false;
        this.autonomy.consecutive_failures = 0;
        this.agent.stateStore?.remember('goal', `Primary goal set: ${goal.name} — ${goal.goal_description}`);
        this._persist();
        return goal;
    }

    clearGoal(name = this.active_goal) {
        if (!name)
            return false;
        const removed = this.goals.removeGoal(name);
        if (this.active_goal === name)
            this.active_goal = this._getHighestPriorityGoal();
        if (!this.active_goal) {
            this.autonomy.enabled = false;
            this.autonomy.paused = false;
        }
        if (removed)
            this.agent.stateStore?.remember('goal', `Goal removed: ${name}`);
        this._persist();
        return removed;
    }

    completeGoal(name = this.active_goal) {
        if (!name || !this.goals.completeGoal(name, true))
            return false;
        this.agent.stateStore?.remember('goal', `Goal completed: ${name}`);
        if (this.active_goal === name)
            this.active_goal = this._getHighestPriorityGoal();
        if (!this.active_goal) {
            this.autonomy.enabled = false;
            this.autonomy.paused = false;
        }
        this._persist();
        return true;
    }

    pauseAutonomy() {
        this.autonomy.paused = true;
        this.agent.stateStore?.remember('goal', `Autonomous work paused for ${this.active_goal || 'all goals'}`);
        this._persist();
    }

    resumeAutonomy() {
        if (!this.active_goal)
            this._ensureActiveGoal();
        this.autonomy.enabled = Boolean(this.active_goal);
        this.autonomy.paused = false;
        this.autonomy.consecutive_failures = 0;
        this.agent.stateStore?.remember('goal', `Autonomous work resumed for ${this.active_goal || 'no goal'}`);
        this._persist();
        return this.isAutonomyActive();
    }

    isAutonomyActive() {
        return Boolean(this.active_goal && this.autonomy.enabled && !this.autonomy.paused);
    }

    getContinuationPrompt(lastResult = null) {
        if (!this.active_goal)
            return null;
        const goal = this.goals.listFormattedGoal(this.active_goal);
        const outcome = lastResult
            ? `The previous task reported: ${lastResult.chat_response || 'no report'} (work_done=${Boolean(lastResult.work_done)}).`
            : 'The process restarted or the agent became idle.';
        return `Continue working autonomously toward the active goal below.\n${goal}\n${outcome}\n` +
            'Inspect current stats, inventory, location, dimension, and nearby blocks before assuming previous actions succeeded. ' +
            'If the overall goal is complete, mark it complete with goal_action and give a short final reply. ' +
            'Otherwise route the next concrete, safe game task to the TaskAgent. Return a short public progress_update describing the approach without private reasoning.';
    }

    _appendUserMessage(source, message) {
        const activeGoalContext = this.active_goal
            ? this.goals.listFormattedGoal(this.active_goal)
            : 'No active goal.';
        const taskAgent = this.agent.taskAgent;
        const taskStatus = taskAgent?.is_running
            ? `[Task Status]: Running "${taskAgent.currentTaskDescription || 'unknown'}" (step ${taskAgent.currentStep || '?'})`
            : '[Task Status]: No task running.';
        const persistentMemory = this.agent.stateStore?.getMemoryContext(
            Number(settings.persistent_memory_context_events) || 12
        ) || 'No persistent memory.';

        this.message_history.push({
            role: 'user',
            content: `[${source}]: ${message}\n\n` +
                `${taskStatus}\n` +
                `[Current Goals]:\n${this.goals.listFormattedGoals()}\n` +
                `[Active Goal]:\n${activeGoalContext}\n` +
                `[Autonomy]: enabled=${this.autonomy.enabled}, paused=${this.autonomy.paused}\n` +
                `[Recent Persistent Memory]:\n${persistentMemory}`
        });
        this._trimHistory();
    }

    _trimHistory() {
        const max = Number(settings.max_messages) || MAX_BRAIN_HISTORY;
        this.message_history = this.message_history.slice(-max);
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

    _handleGoalAction(goalAction) {
        const {
            action, goal, priority, goal_description, checklist,
            checklist_item, checklist_completed, autonomous
        } = goalAction || {};

        switch (action) {
            case 'add':
                if (goal) {
                    const items = Array.isArray(checklist)
                        ? checklist.map(description => new checklistItem(description))
                        : [];
                    this.goals.addGoal(goal, goal_description || '', priority || 1, items);
                    this.active_goal = goal;
                    if (autonomous !== false) {
                        this.autonomy.enabled = true;
                        this.autonomy.paused = false;
                    }
                }
                break;
            case 'remove':
                this.clearGoal(goal);
                return;
            case 'complete':
                this.completeGoal(goal);
                return;
            case 'set_active':
                if (goal && this.goals.getGoal(goal)) {
                    this.active_goal = goal;
                    this.autonomy.enabled = autonomous !== false;
                    this.autonomy.paused = false;
                }
                break;
            case 'set_priority':
                if (goal && priority !== undefined)
                    this.goals.setPriority(goal, priority);
                break;
            case 'mark_checklist_item':
                if (goal && checklist_item) {
                    const completed = checklist_completed !== undefined ? checklist_completed : true;
                    this.goals.markChecklistItem(goal, checklist_item, completed);
                }
                break;
            case 'recreate_checklist_item':
                if (goal && checklist_item)
                    this.goals.addChecklistItem(goal, checklist_item);
                break;
            case 'pause':
                this.pauseAutonomy();
                return;
            case 'resume':
                this.resumeAutonomy();
                return;
            default:
                log.warn(`Unknown goal action: ${action}`);
        }
        this._ensureActiveGoal();
        this._persist();
    }

    _ensureActiveGoal() {
        if (this.active_goal && !this.goals.getGoal(this.active_goal))
            this.active_goal = null;
        if (!this.active_goal)
            this.active_goal = this._getHighestPriorityGoal();
    }

    _getHighestPriorityGoal() {
        return this.goals.getHighestPriorityIncompleteGoal()?.name || null;
    }

    _persist() {
        this.agent.stateStore?.saveBrain({
            goals: this.goals.listGoals(),
            activeGoal: this.active_goal,
            messageHistory: this.message_history,
            autonomy: this.autonomy
        });
    }

    getStatus() {
        return {
            active_goal: this.active_goal,
            autonomy: { ...this.autonomy },
            goals: this.goals.listGoals(),
            history_length: this.message_history.length
        };
    }
}
