import test from 'node:test';
import assert from 'node:assert/strict';
import { getToolDefinitions, initializeTools, parseToolCall } from '../src/agent/commands/index.js';

test('tool loader discovers persistent goal commands', async () => {
    await initializeTools();
    const names = getToolDefinitions().map(definition => definition.function.name);
    assert.ok(names.includes('setGoal'));
    assert.ok(names.includes('goalStatus'));
    assert.ok(names.includes('resumeGoal'));
});

test('manual Minecraft command syntax maps to positional arguments', async () => {
    await initializeTools();
    assert.deepEqual(
        parseToolCall('!setGoal("Beat Minecraft", "Defeat the dragon", 100)'),
        {
            name: 'setGoal',
            arguments: ['Beat Minecraft', 'Defeat the dragon', 100]
        }
    );
});
