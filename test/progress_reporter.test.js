import test from 'node:test';
import assert from 'node:assert/strict';
import { formatToolProgress, ProgressReporter } from '../src/agent/progress_reporter.js';

test('tool progress is human-readable and hides verbose arguments', () => {
    assert.equal(
        formatToolProgress({ name: 'searchWiki', arguments: { query: 'Nether fortress spawning' } }),
        'Searching the Minecraft wiki: Nether fortress spawning'
    );
    assert.equal(formatToolProgress({ name: 'inventory', arguments: {} }), 'Using inventory');
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
