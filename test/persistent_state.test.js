import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PersistentAgentState } from '../src/agent/persistent_state.js';

test('persistent state restores goals, memory, places and running task', () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), 'mindcraft-state-'));
    try {
        const store = new PersistentAgentState('tester', { baseDir, maxEvents: 3 });
        store.saveBrain({
            goals: [{ name: 'Beat Minecraft', priority: 100, check_list: [] }],
            activeGoal: 'Beat Minecraft',
            messageHistory: [{ role: 'user', content: 'start' }],
            autonomy: { enabled: true, paused: false }
        });
        store.savePlaces({ portal: [1, 64, 2] });
        store.remember('plan', 'Find a Nether fortress');
        store.saveTask({
            id: 'task-1',
            status: 'running',
            description: 'Find a Nether fortress',
            step: 7,
            history: [{ role: 'system', content: 'task prompt' }]
        });

        const restored = new PersistentAgentState('tester', { baseDir });
        assert.equal(restored.snapshot().active_goal, 'Beat Minecraft');
        assert.deepEqual(restored.snapshot().places.portal, [1, 64, 2]);
        assert.equal(restored.getPendingTask().step, 7);
        assert.match(restored.getMemoryContext(), /Nether fortress/);
        assert.match(restored.searchMemory('fortress'), /Nether fortress/);
        assert.doesNotThrow(() => JSON.parse(readFileSync(restored.filePath, 'utf8')));
    } finally {
        rmSync(baseDir, { recursive: true, force: true });
    }
});

test('finished tasks are not resumed and event memory is bounded', () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), 'mindcraft-state-'));
    try {
        const store = new PersistentAgentState('tester', { baseDir, maxEvents: 2 });
        store.saveTask({ id: 'task-2', status: 'running', description: 'Mine iron', history: [] });
        store.remember('one', 'first');
        store.remember('two', 'second');
        store.remember('three', 'third');
        store.finishTask('completed', { work_done: true });

        assert.equal(store.getPendingTask(), null);
        assert.equal(store.snapshot().last_task.status, 'completed');
        assert.equal(store.snapshot().memory_events.length, 2);
        assert.doesNotMatch(store.getMemoryContext(), /first/);
    } finally {
        rmSync(baseDir, { recursive: true, force: true });
    }
});
