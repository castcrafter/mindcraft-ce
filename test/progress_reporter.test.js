import test from 'node:test';
import assert from 'node:assert/strict';
import {
    formatDecisionProgress,
    formatToolProgress,
    formatToolResult,
    ProgressReporter
} from '../src/agent/progress_reporter.js';

test('tool progress is human-readable and hides verbose arguments', () => {
    assert.equal(
        formatToolProgress({ name: 'searchWiki', arguments: { query: 'Nether fortress spawning' } }),
        'Searching the Minecraft wiki: Nether fortress spawning'
    );
    assert.equal(formatToolProgress({ name: 'inventory', arguments: {} }), 'Checking inventory');
    assert.equal(
        formatToolResult({ name: 'inventory' }, 'iron_ingot x12, sticks x4'),
        'Checking inventory -> iron_ingot x12, sticks x4'
    );
});

test('decision progress explains reasoning, next action and verified result without step numbers', () => {
    const message = formatDecisionProgress({
        thought: 'I have enough iron for the missing helmet but still need boots',
        progress_update: 'Craft the helmet first, then recount the remaining ingots',
        step_report: 'Inventory contains 12 iron ingots'
    }, { maxLength: 300 });

    assert.match(message, /Thinking: I have enough iron/);
    assert.match(message, /Next: Craft the helmet/);
    assert.match(message, /Result: Inventory contains 12 iron ingots/);
    assert.doesNotMatch(message, /step \d+/i);
});

test('thinking status reviews the last meaningful update instead of exposing an internal step counter', () => {
    const messages = [];
    const reporter = new ProgressReporter(
        { openChat: message => messages.push(message) },
        { minIntervalMs: 1, thinkingIntervalMs: 100000, prefix: '' }
    );
    const stop = reporter.startThinking({
        task: 'Craft full iron armor (step 11)',
        lastUpdate: 'The chestplate is complete; boots are still missing'
    });
    stop();

    assert.deepEqual(messages, ['Reviewing: The chestplate is complete; boots are still missing']);
    assert.doesNotMatch(messages[0], /step 11/i);
});

test('progress reporter deduplicates and respects explicit disable', async () => {
    const messages = [];
    const agent = { openChat: message => messages.push(message) };
    const reporter = new ProgressReporter(agent, {
        enabled: true,
        minIntervalMs: 1,
        thinkingIntervalMs: 100000,
        prefix: '[status] '
    });
    reporter.report('Checking armor', { force: true });
    reporter.report('Checking armor', { force: true });
    assert.deepEqual(messages, ['[status] Checking armor']);

    const disabled = new ProgressReporter(agent, { enabled: false });
    const stop = disabled.startThinking('anything');
    stop();
    disabled.report('hidden', { force: true });
    await Promise.resolve();
    assert.equal(messages.length, 1);
});
