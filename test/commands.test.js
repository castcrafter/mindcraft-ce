import test from 'node:test';
import assert from 'node:assert/strict';
import { getToolDefinitions, initializeTools, parseToolCall, parseToolCalls } from '../src/agent/commands/index.js';

test('tool loader discovers persistent goal commands', async () => {
    await initializeTools();
    const names = getToolDefinitions().map(definition => definition.function.name);
    assert.ok(names.includes('setGoal'));
    assert.ok(names.includes('goalStatus'));
    assert.ok(names.includes('resumeGoal'));
});

test('legacy command aliases and multiple inline commands are recovered', async () => {
    await initializeTools();
    assert.equal(parseToolCall('!NEARBY-BLOCKS()').name, 'nearbyBlocks');
    assert.deepEqual(
        parseToolCalls('First !stats(), then !inventory()').map(call => call.name),
        ['stats', 'inventory']
    );
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
