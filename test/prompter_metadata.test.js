import test from 'node:test';
import assert from 'node:assert/strict';
import { Prompter } from '../src/models/prompter.js';

test('Prompter preserves provider metadata for optional reasoning logs', async () => {
    const metadata = {
        assistant_message: {
            role: 'assistant',
            content: '{}',
            reasoning_content: 'provider reasoning'
        }
    };
    const prompter = Object.create(Prompter.prototype);
    prompter.profile = { brain_agent: '' };
    prompter.checkCooldown = async () => {};
    prompter.chat_model = {
        async sendRequest() {
            return ['{}', [], metadata];
        }
    };

    const [generation, calls, returnedMetadata] = await prompter.handleRequest('brain', []);
    assert.equal(generation, '{}');
    assert.deepEqual(calls, []);
    assert.equal(returnedMetadata, metadata);
});
