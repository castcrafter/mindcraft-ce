import OpenAIApi from 'openai';
import { getKey } from '../utils/keys.js';
import { responseFormatSchema } from './_response_format.js';

const DEFAULT_MODEL = 'deepseek-v4-pro';
const DEFAULT_RETRIES = 3;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseArguments(value) {
    if (!value)
        return {};
    if (typeof value === 'object')
        return value;
    try {
        return JSON.parse(value);
    } catch {
        return {};
    }
}

function schemaInstruction(responseFormat) {
    const schema = responseFormat?.json_schema?.schema;
    if (!schema)
        return '';
    return `\n\nReturn one valid JSON object matching this JSON Schema exactly:\n${JSON.stringify(schema)}`;
}

export function normalizeDeepSeekResponseFormat(responseFormat) {
    if (!responseFormat)
        return null;
    if (responseFormat.type === 'json_schema')
        return { type: 'json_object' };
    if (responseFormat.type === 'json_object' || responseFormat.type === 'text')
        return { type: responseFormat.type };
    return null;
}

export function normalizeDeepSeekMessages(turns = [], systemMessage = null, responseFormat = null) {
    const messages = [];
    const instruction = schemaInstruction(responseFormat);
    if (systemMessage || instruction) {
        messages.push({
            role: 'system',
            content: `${systemMessage || 'Respond in JSON.'}${instruction}`
        });
    }

    for (const original of turns || []) {
        if (!original || !original.role)
            continue;
        const message = { role: original.role };
        if (original.content !== undefined)
            message.content = original.content;
        if (original.name)
            message.name = original.name;
        if (original.tool_call_id)
            message.tool_call_id = original.tool_call_id;
        if (original.tool_calls)
            message.tool_calls = original.tool_calls;
        if (original.reasoning_content)
            message.reasoning_content = original.reasoning_content;
        messages.push(message);
    }

    if (messages.length === 0)
        messages.push({ role: 'user', content: '_' });
    return messages;
}

function isTransient(error) {
    const code = error?.code || error?.cause?.code;
    const status = Number(error?.status);
    return [408, 409, 425, 429, 500, 502, 503, 504].includes(status) ||
        ['ERR_STREAM_PREMATURE_CLOSE', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code) ||
        /premature close|socket hang up|network|connection|temporarily|timeout|empty JSON response/i.test(error?.message || '');
}

function plainAssistantMessage(message) {
    const assistant = {
        role: 'assistant',
        content: message?.content ?? ''
    };
    if (message?.reasoning_content)
        assistant.reasoning_content = message.reasoning_content;
    if (message?.tool_calls?.length) {
        assistant.tool_calls = message.tool_calls.map(call => ({
            id: call.id,
            type: 'function',
            function: {
                name: call.function?.name || '',
                arguments: call.function?.arguments || '{}'
            }
        }));
    }
    return assistant;
}

function resultFromMessage(message) {
    const functionCalls = (message?.tool_calls || []).map(call => ({
        id: call.id,
        name: call.function?.name,
        arguments: parseArguments(call.function?.arguments)
    }));
    return [
        message?.content || '',
        functionCalls,
        { assistant_message: plainAssistantMessage(message) }
    ];
}

async function collectStream(stream) {
    let content = '';
    let reasoningContent = '';
    const toolCalls = new Map();
    let finishReason = null;

    for await (const chunk of stream) {
        const choice = chunk?.choices?.[0];
        if (!choice)
            continue;
        finishReason = choice.finish_reason || finishReason;
        const delta = choice.delta || {};
        if (delta.content)
            content += delta.content;
        if (delta.reasoning_content)
            reasoningContent += delta.reasoning_content;

        for (const toolDelta of delta.tool_calls || []) {
            const key = toolDelta.index ?? toolDelta.id ?? toolCalls.size;
            const existing = toolCalls.get(key) || {
                id: toolDelta.id || `call_${key}`,
                type: 'function',
                function: { name: '', arguments: '' }
            };
            if (toolDelta.id)
                existing.id = toolDelta.id;
            if (toolDelta.function?.name)
                existing.function.name += toolDelta.function.name;
            if (toolDelta.function?.arguments)
                existing.function.arguments += toolDelta.function.arguments;
            toolCalls.set(key, existing);
        }
    }

    if (finishReason === 'length')
        throw new Error('Context length exceeded');
    if (finishReason === 'insufficient_system_resource') {
        const error = new Error('DeepSeek reported insufficient system resources.');
        error.code = 'DEEPSEEK_INSUFFICIENT_RESOURCES';
        throw error;
    }

    return {
        role: 'assistant',
        content,
        reasoning_content: reasoningContent,
        tool_calls: [...toolCalls.values()]
    };
}

export class DeepSeek {
    static prefix = 'deepseek';

    constructor(modelName, url, params = {}) {
        this.model_name = modelName || DEFAULT_MODEL;
        this.params = params || {};
        this.openai = new OpenAIApi({
            baseURL: url || 'https://api.deepseek.com',
            apiKey: getKey('DEEPSEEK_API_KEY'),
            defaultHeaders: {
                // Avoid intermittent gzip truncation seen behind some proxies/CDNs.
                'Accept-Encoding': 'identity'
            }
        });
    }

    async sendRequest(turns, systemMessage, tools = [], responseFormat = responseFormatSchema) {
        const normalizedFormat = normalizeDeepSeekResponseFormat(responseFormat);
        const messages = normalizeDeepSeekMessages(turns, systemMessage, responseFormat);
        const params = { ...this.params };
        const maxRetries = Number(params.request_retries) || DEFAULT_RETRIES;
        delete params.request_retries;

        let useStreaming = params.stream !== undefined ? Boolean(params.stream) : false;
        const pack = {
            ...params,
            model: this.model_name,
            messages
        };
        if (tools?.length) {
            pack.tools = tools;
            pack.tool_choice = pack.tool_choice || 'auto';
        } else {
            delete pack.tools;
            delete pack.tool_choice;
        }
        if (normalizedFormat)
            pack.response_format = normalizedFormat;
        else
            delete pack.response_format;

        let lastError;
        for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
            try {
                console.log(`Awaiting DeepSeek API response (attempt ${attempt}/${maxRetries + 1}, stream=${useStreaming})...`);
                const completion = await this.openai.chat.completions.create({ ...pack, stream: useStreaming });
                const message = useStreaming
                    ? await collectStream(completion)
                    : completion?.choices?.[0]?.message;
                const finishReason = useStreaming ? null : completion?.choices?.[0]?.finish_reason;
                if (finishReason === 'length')
                    throw new Error('Context length exceeded');
                if (!message)
                    throw new Error('DeepSeek returned no message.');
                if (!message.content && !message.tool_calls?.length && normalizedFormat?.type === 'json_object')
                    throw new Error('DeepSeek returned an empty JSON response.');
                console.log('Received DeepSeek response.');
                return resultFromMessage(message);
            } catch (error) {
                lastError = error;
                const contextError = error.message === 'Context length exceeded' || error.code === 'context_length_exceeded';
                if (contextError && turns?.length > 1)
                    return this.sendRequest(turns.slice(1), systemMessage, tools, responseFormat);

                if (useStreaming && /premature close|stream|connection|network|socket/i.test(error.message || '')) {
                    console.warn('DeepSeek stream was interrupted; retrying this request without streaming.');
                    useStreaming = false;
                }

                if (attempt > maxRetries || !isTransient(error))
                    break;
                const delay = Math.min(8000, 1000 * (2 ** (attempt - 1)));
                console.warn(`DeepSeek request failed temporarily (${error.code || error.status || error.message}). Retrying in ${delay}ms.`);
                await sleep(delay);
            }
        }

        console.error('DeepSeek request failed permanently:', lastError?.message || lastError);
        throw lastError || new Error('DeepSeek request failed.');
    }

    embed() {
        throw new Error('Embeddings are not supported by DeepSeek. Configure an embedding model in the profile.');
    }
}
