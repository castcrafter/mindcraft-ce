import { rpAgentResponseFormat } from './responseFormat.js';
import { createLogger } from '../../utils/logger.js';
import settings from '../settings.js';

const log = createLogger('RPAgent');

const MAX_MEMORY_PER_PLAYER = 20;

export class RPAgent {
    constructor(agent) {
        this.agent = agent;
        const saved = agent.stateStore?.snapshot?.().rp || {};
        this.playerMemories = saved.player_memories || {};
        this.playerNotes = saved.player_notes || {};
    }

    async respond(source, message, brainContext) {
        const memory = this._getPlayerMemory(source);

        let userContent = `${source}: ${message}`;
        if (brainContext?.progress_update)
            userContent += `\n\n[Planner's public summary]: ${brainContext.progress_update}`;
        memory.push({ role: 'user', content: userContent });

        const notes = this.playerNotes[source];
        const notesContext = notes ? `\n\n[Your notes about ${source}]: ${notes}` : '';

        const messagesForLLM = [...memory];
        if (notesContext && messagesForLLM.length > 0) {
            messagesForLLM[0] = {
                ...messagesForLLM[0],
                content: notesContext + '\n\n' + messagesForLLM[0].content
            };
        }

        let response;
        const stopThinking = this.agent.progress?.startThinking?.(`a reply to ${source}`) || (() => {});
        try {
            [response] = await this.agent.prompter.handleRequest(
                'rp', messagesForLLM, [], rpAgentResponseFormat
            );
        } catch (error) {
            log.error('LLM request failed:', error);
            return null;
        } finally {
            stopThinking();
        }

        if (!response) return null;

        let parsed;
        try {
            parsed = JSON.parse(response);
        } catch (e) {
            log.warn('Failed to parse response as JSON:', response);
            memory.push({ role: 'assistant', content: response });
            this._trimMemory(source);
            this._persist();
            return response;
        }

        memory.push({ role: 'assistant', content: response });
        this._trimMemory(source);

        if (parsed.internal_notes)
            this._updateNotes(source, parsed.internal_notes);
        if (parsed.relationship_updates)
            this._updateNotes(source, parsed.relationship_updates);

        this._persist();
        this.agent.stateStore?.remember('conversation', `${this.agent.name} to ${source}: ${parsed.chat_response || ''}`);

        log.info(`Response to ${source}: ${parsed.chat_response}`);
        if (parsed.internal_notes)
            log.debug(`Notes about ${source}: ${parsed.internal_notes}`);

        return parsed.chat_response || null;
    }

    _getPlayerMemory(source) {
        if (!this.playerMemories[source])
            this.playerMemories[source] = [];
        return this.playerMemories[source];
    }

    _trimMemory(source) {
        const max = settings.max_messages || MAX_MEMORY_PER_PLAYER;
        const memory = this.playerMemories[source];
        if (memory && memory.length > max)
            this.playerMemories[source] = memory.slice(-max);
    }

    _updateNotes(source, newNotes) {
        const existing = this.playerNotes[source] || '';
        const combined = existing ? `${existing}\n${newNotes}` : newNotes;
        this.playerNotes[source] = combined.length > 500
            ? '...' + combined.slice(-497)
            : combined;
    }

    _persist() {
        this.agent.stateStore?.saveRP(this.playerMemories, this.playerNotes);
    }
}
