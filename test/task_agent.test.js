import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PersistentAgentState } from '../src/agent/persistent_state.js';
import { TaskAgent } from '../src/agent/agents/task.js';
import { initializeTools, registerTool } from '../src/agent/commands/index.js';

function fakeAgent(store, responses) {
    return {
        blocked_actions: [],
        stateStore: store,
        progress: {
            report() {},
            tool() {},
            startThinking() { return () => {}; }
        },
        requestInterrupt() {},
        prompter: {
            profile: {},
            chat_model: {
                async sendRequest() {
                    return responses.shift();
                }
            },
            async replaceStrings(value) { return value; }
        }
    };
}

test('TaskAgent completes a bounded task and clears its recovery checkpoint', async () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), 'mindcraft-task-'));
    try {
        const store = new PersistentAgentState('tester', { baseDir });
        const response = JSON.stringify({
            thought: 'private',
            progress_update: 'Inventory is verified',
            step_report: 'The requested state is confirmed',
            work_done: true,
            chat_response: 'Done.'
        });
        const task = new TaskAgent(fakeAgent(store, [[response, []]]), null);
        const result = await task.performTask('Check inventory', 'Verify inventory.');

        assert.equal(result.work_done, true);
        assert.equal(result.chat_response, 'Done.');
        assert.equal(store.getPendingTask(), null);
        assert.equal(store.snapshot().last_task.status, 'completed');
        assert.match(store.searchMemory('Inventory'), /Inventory is verified/);
    } finally {
        rmSync(baseDir, { recursive: true, force: true });
    }
});

test('TaskAgent resumes a saved task with a recovery instruction', async () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), 'mindcraft-task-'));
    try {
        const store = new PersistentAgentState('tester', { baseDir });
        store.saveTask({
            id: 'resume-1',
            status: 'running',
            description: 'Find fortress',
            system_prompt: 'Search safely.',
            source: 'system',
            step: 4,
            no_tool_streak: 0,
            history: [{ role: 'system', content: 'saved task prompt' }],
            started_at: new Date().toISOString()
        });

        let capturedHistory;
        const response = JSON.stringify({
            thought: 'private',
            progress_update: 'State rechecked',
            step_report: 'Recovery verified',
            work_done: true,
            chat_response: 'Recovered.'
        });
        const agent = fakeAgent(store, []);
        agent.prompter.chat_model.sendRequest = async history => {
            capturedHistory = history;
            return [response, []];
        };
        const task = new TaskAgent(agent, null);
        const result = await task.performTask(
            'Find fortress', 'Search safely.', { resumeState: store.getPendingTask(), source: 'system' }
        );

        assert.equal(result.work_done, true);
        assert.equal(result.steps, 5);
        assert.ok(capturedHistory.some(message => /process restarted/.test(message.content)));
        assert.equal(store.getPendingTask(), null);
    } finally {
        rmSync(baseDir, { recursive: true, force: true });
    }
});

test('TaskAgent converts a model-written legacy command into a real tool call', async () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), 'mindcraft-task-'));
    try {
        await initializeTools();
        let executions = 0;
        registerTool({
            name: 'testProbe',
            description: 'Test-only probe.',
            parameters: [],
            is_action: false,
            execute() {
                executions++;
                return 'probe succeeded';
            }
        });

        const store = new PersistentAgentState('tester', { baseDir });
        const legacyResponse = JSON.stringify({
            thought: 'Use the old syntax by mistake',
            progress_update: 'Checking state',
            step_report: '',
            work_done: false,
            chat_response: '!TEST-PROBE()'
        });
        const completeResponse = JSON.stringify({
            thought: 'The probe result is available',
            progress_update: 'State checked',
            step_report: 'probe succeeded',
            work_done: true,
            chat_response: 'Done.'
        });
        const task = new TaskAgent(fakeAgent(store, [
            [legacyResponse, []],
            [completeResponse, []]
        ]), null);

        assert.deepEqual(
            task._recoverLegacyToolCalls('ignored', { thought: 'Do not use !testProbe in prose.' }),
            []
        );
        assert.equal(
            task._recoverLegacyToolCalls('ignored', { thought: '!TEST-PROBE()' })[0].name,
            'testProbe'
        );

        const result = await task.performTask('Run probe', 'Use the probe tool.');
        assert.equal(executions, 1);
        assert.equal(result.work_done, true);
        assert.match(store.searchMemory('legacy_tool_recovery'), /testProbe/);
        assert.match(store.searchMemory('probe succeeded'), /probe succeeded/);
    } finally {
        rmSync(baseDir, { recursive: true, force: true });
    }
});
