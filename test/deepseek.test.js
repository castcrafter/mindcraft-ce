import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DeepSeek,
    normalizeDeepSeekMessages,
    normalizeDeepSeekResponseFormat
} from '../src/models/deepseek.js';

test('DeepSeek JSON schema is converted to supported JSON object mode', () => {
    const format = {
        type: 'json_schema',
        json_schema: { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } }
    };
    assert.deepEqual(normalizeDeepSeekResponseFormat(format), { type: 'json_object' });
    const messages = normalizeDeepSeekMessages([], 'Return a result.', format);
    assert.equal(messages[0].role, 'system');
    assert.match(messages[0].content, /JSON Schema/);
});

test('DeepSeek messages preserve reasoning and tool call context', () => {
    const messages = normalizeDeepSeekMessages([
        {
            role: 'assistant',
            content: '',
            reasoning_content: 'private reasoning required by the API',
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'stats', arguments: '{}' } }]
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'health: 20' }
    ]);
    assert.equal(messages[0].reasoning_content, 'private reasoning required by the API');
    assert.equal(messages[1].tool_call_id, 'call_1');
});

test('DeepSeek streaming collects content, reasoning and tool arguments', async () => {
    const model = Object.create(DeepSeek.prototype);
    model.model_name = 'deepseek-v4-pro';
    model.params = { stream: true, request_retries: 0 };
    let requestPack;
    model.openai = {
        chat: {
            completions: {
                create: async pack => {
                    requestPack = pack;
                    return (async function* stream() {
                        yield { choices: [{ delta: { reasoning_content: 'checking ' } }] };
                        yield { choices: [{ delta: { reasoning_content: 'inventory' } }] };
                        yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'inventory', arguments: '{' } }] } }] };
                        yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] }, finish_reason: 'tool_calls' }] };
                    })();
                }
            }
        }
    };

    const [content, calls, metadata] = await model.sendRequest(
        [{ role: 'user', content: 'check inventory' }], null, [{ type: 'function', function: { name: 'inventory' } }], null
    );
    assert.equal(requestPack.stream, true);
    assert.equal(content, '');
    assert.deepEqual(calls[0], { id: 'call_1', name: 'inventory', arguments: {} });
    assert.equal(metadata.assistant_message.reasoning_content, 'checking inventory');
    assert.equal(metadata.assistant_message.tool_calls[0].id, 'call_1');
});
