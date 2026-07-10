import OpenAIApi from 'openai';
import { getKey, hasKey } from '../utils/keys.js';
import { strictFormat } from '../utils/text.js';
import { responseFormatSchema } from './_response_format.js';

function toResponsesTools(tools = []) {
    return tools.map(tool => tool?.function ? {
        type: 'function',
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        strict: tool.function.strict
    } : tool);
}

function toResponsesFormat(responseFormat) {
    if (!responseFormat)
        return null;
    if (responseFormat.type === 'json_schema' && responseFormat.json_schema) {
        return {
            type: 'json_schema',
            name: responseFormat.json_schema.name || 'agent_response',
            schema: responseFormat.json_schema.schema,
            // Agent schemas contain optional fields, so use non-strict schema guidance.
            strict: false
        };
    }
    return responseFormat;
}

export class GPT {
    static prefix = 'openai';
    constructor(model_name, url, params) {
        this.model_name = model_name;
        this.params = params;

        let config = {};
        if (url)
            config.baseURL = url;

        if (hasKey('OPENAI_ORG_ID'))
            config.organization = getKey('OPENAI_ORG_ID');

        config.apiKey = getKey('OPENAI_API_KEY');

        this.openai = new OpenAIApi(config);
    }

    async sendRequest(turns, systemMessage, tools = [], responseFormat = responseFormatSchema) {
        let messages = strictFormat(turns);
        let model = this.model_name || "gpt-4o-mini";

        let res = null;
        let function_calls = [];

        try {
            console.log('Awaiting openai api response from model', model)
            const request = {
                model: model,
                instructions: systemMessage,
                input: messages,
                ...(this.params || {})
            };
            if (tools?.length)
                request.tools = toResponsesTools(tools);
            const format = toResponsesFormat(responseFormat);
            if (format)
                request.text = { format };
            const response = await this.openai.responses.create(request);
            console.log('Received.')
            res = response.output_text;
            for (const tool_call of (response.output || []).filter(item => item.type === 'function_call')) {
                function_calls.push({
                    id: tool_call.call_id || tool_call.id,
                    name: tool_call.name,
                    arguments: tool_call.arguments
                });
            }
        }
        catch (err) {
            if ((err.message == 'Context length exceeded' || err.code == 'context_length_exceeded') && turns.length > 1) {
                console.log('Context length exceeded, trying again with shorter context.');
                return await this.sendRequest(turns.slice(1), systemMessage, tools, responseFormat);
            } else if (err.message.includes('image_url')) {
                console.log(err);
                res = 'Vision is only supported by certain models.';
            } else {
                console.log(err);
                res = 'My brain disconnected, try again.';
            }
        }
        return [res, function_calls];
    }

    async sendVisionRequest(messages, systemMessage, imageBuffer, tools = [], responseFormat = responseFormatSchema) {
        const imageMessages = [...messages];
        imageMessages.push({
            role: "user",
            content: [
                { type: "input_text", text: systemMessage },
                {
                    type: "input_image",
                    image_url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
                }
            ]
        });
        
        return this.sendRequest(imageMessages, systemMessage, tools, responseFormat);
    }

    async embed(text) {
        if (text.length > 8191)
            text = text.slice(0, 8191);
        const embedding = await this.openai.embeddings.create({
            model: this.model_name || "text-embedding-3-small",
            input: text,
            encoding_format: "float",
        });
        return embedding.data[0].embedding;
    }

}

const sendAudioRequest = async (text, model, voice, url) => {
    const payload = {
        model: model,
        voice: voice,
        input: text
    }

    let config = {};

    if (url)
        config.baseURL = url;

    if (hasKey('OPENAI_ORG_ID'))
        config.organization = getKey('OPENAI_ORG_ID');

    config.apiKey = getKey('OPENAI_API_KEY');

    const openai = new OpenAIApi(config);

    const mp3 = await openai.audio.speech.create(payload);
    const buffer = Buffer.from(await mp3.arrayBuffer());
    const base64 = buffer.toString("base64");
    return base64;
}

export const TTSConfig = {
    sendAudioRequest: sendAudioRequest,
    baseUrl: 'https://api.openai.com/v1',
}
