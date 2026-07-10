import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PersistentAgentState } from '../src/agent/persistent_state.js';
import { TaskAgent } from '../src/agent/agents/task.js';

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
