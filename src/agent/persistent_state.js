import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync
} from 'fs';
import path from 'path';

const STATE_VERSION = 1;

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function cleanText(value, maxLength = 1000) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function defaultState() {
    return {
        version: STATE_VERSION,
        updated_at: new Date().toISOString(),
        goals: [],
        active_goal: null,
        autonomy: {
            enabled: false,
            paused: false,
            consecutive_failures: 0
        },
        brain_history: [],
        rp: {
            player_memories: {},
            player_notes: {}
        },
        task: null,
        last_task: null,
        places: {},
        memory_events: []
    };
}

function normalizeState(raw) {
    const base = defaultState();
    const state = raw && typeof raw === 'object' ? raw : {};
    return {
        ...base,
        ...state,
        version: STATE_VERSION,
        goals: Array.isArray(state.goals) ? state.goals : [],
        autonomy: { ...base.autonomy, ...(state.autonomy || {}) },
        brain_history: Array.isArray(state.brain_history) ? state.brain_history : [],
        rp: {
            player_memories: state.rp?.player_memories || {},
            player_notes: state.rp?.player_notes || {}
        },
        places: state.places && typeof state.places === 'object' ? state.places : {},
        memory_events: Array.isArray(state.memory_events) ? state.memory_events : []
    };
}

export class PersistentAgentState {
    constructor(agentName, options = {}) {
        this.agentName = agentName;
        this.enabled = options.enabled !== false;
        this.maxEvents = Number(options.maxEvents) || 120;
        this.maxBrainMessages = Number(options.maxBrainMessages) || 20;
        this.maxTaskMessages = Number(options.maxTaskMessages) || 30;
        this.baseDir = options.baseDir || './bots';
        this.agentDir = path.join(this.baseDir, agentName);
        this.filePath = options.filePath || path.join(this.agentDir, 'agent_state.json');

        if (this.enabled)
            mkdirSync(this.agentDir, { recursive: true });

        this.state = this._load();
    }

    _load() {
        if (!this.enabled || !existsSync(this.filePath))
            return defaultState();

        try {
            return normalizeState(JSON.parse(readFileSync(this.filePath, 'utf8')));
        } catch (error) {
            const corruptPath = `${this.filePath}.corrupt-${Date.now()}`;
            try {
                copyFileSync(this.filePath, corruptPath);
            } catch {
                // The fresh state below is still usable even if backup creation fails.
            }
            console.error(`[PersistentAgentState] Could not load ${this.filePath}: ${error.message}`);
            return defaultState();
        }
    }

    reload() {
        this.state = this._load();
        return this.snapshot();
    }

    snapshot() {
        return clone(this.state);
    }

    save() {
        if (!this.enabled)
            return;

        this.state.version = STATE_VERSION;
        this.state.updated_at = new Date().toISOString();
        mkdirSync(path.dirname(this.filePath), { recursive: true });

        const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
        writeFileSync(temporaryPath, JSON.stringify(this.state, null, 2), 'utf8');
        try {
            renameSync(temporaryPath, this.filePath);
        } catch {
            // Windows can reject replacing an existing destination with renameSync.
            copyFileSync(temporaryPath, this.filePath);
            unlinkSync(temporaryPath);
        }
    }

    saveBrain({ goals, activeGoal, messageHistory, autonomy }) {
        this.state.goals = clone(goals || []);
        this.state.active_goal = activeGoal || null;
        this.state.brain_history = clone((messageHistory || []).slice(-this.maxBrainMessages));
        if (autonomy)
            this.state.autonomy = { ...this.state.autonomy, ...clone(autonomy) };
        this.save();
    }

    saveRP(playerMemories, playerNotes) {
        this.state.rp = {
            player_memories: clone(playerMemories || {}),
            player_notes: clone(playerNotes || {})
        };
        this.save();
    }

    saveTask(task) {
        if (!task) {
            this.state.task = null;
            this.save();
            return;
        }

        const storedTask = clone(task);
        if (Array.isArray(storedTask.history) && storedTask.history.length > this.maxTaskMessages) {
            const systemMessage = storedTask.history.find(message => message.role === 'system');
            const recent = storedTask.history.slice(-(this.maxTaskMessages - (systemMessage ? 1 : 0)));
            storedTask.history = systemMessage && recent[0] !== systemMessage
                ? [systemMessage, ...recent]
                : recent;
        }
        storedTask.updated_at = new Date().toISOString();
        this.state.task = storedTask;
        this.save();
    }

    finishTask(status, result = {}) {
        const previous = this.state.task || {};
        this.state.last_task = {
            ...clone(previous),
            history: undefined,
            status,
            result: clone(result),
            finished_at: new Date().toISOString()
        };
        this.state.task = null;
        this.save();
    }

    getPendingTask() {
        return this.state.task?.status === 'running' ? clone(this.state.task) : null;
    }

    savePlaces(places) {
        this.state.places = clone(places || {});
        this.save();
    }

    setAutonomy(update) {
        this.state.autonomy = { ...this.state.autonomy, ...clone(update || {}) };
        this.save();
    }

    remember(type, message, metadata = {}) {
        const cleaned = cleanText(message);
        if (!cleaned)
            return;

        this.state.memory_events.push({
            timestamp: new Date().toISOString(),
            type: cleanText(type || 'note', 40),
            message: cleaned,
            metadata: clone(metadata)
        });
        this.state.memory_events = this.state.memory_events.slice(-this.maxEvents);
        this.save();
    }

    getMemoryContext(limit = 12) {
        const events = this.state.memory_events.slice(-Math.max(1, Number(limit) || 12));
        if (events.length === 0)
            return 'No persistent memories yet.';
        return events.map(event =>
            `- ${event.timestamp} [${event.type}]: ${event.message}`
        ).join('\n');
    }

    searchMemory(query, limit = 5) {
        const terms = cleanText(query).toLowerCase().split(/\s+/).filter(Boolean);
        const events = [...this.state.memory_events].reverse();
        const ranked = events.map((event, index) => {
            const haystack = `${event.type} ${event.message} ${JSON.stringify(event.metadata || {})}`.toLowerCase();
            const score = terms.length === 0
                ? 1
                : terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
            return { event, score, recency: events.length - index };
        }).filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score || b.recency - a.recency)
            .slice(0, Math.max(1, Number(limit) || 5));

        return ranked.map(({ event }) =>
            `${event.timestamp} [${event.type}] ${event.message}`
        ).join('\n');
    }
}

export default PersistentAgentState;
