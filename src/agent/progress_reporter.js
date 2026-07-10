import settings from './settings.js';

const TOOL_LABELS = {
    attack: 'Fighting',
    attackPlayer: 'Fighting player',
    collectBlocks: 'Collecting blocks',
    consume: 'Eating',
    craftRecipe: 'Crafting',
    digDown: 'Digging down',
    equip: 'Equipping gear',
    executeCode: 'Running a complex action',
    generateAugment: 'Creating a reusable action',
    getCraftingPlan: 'Planning a recipe',
    goToBed: 'Going to bed',
    goToCoordinates: 'Travelling',
    goToPlayer: 'Going to player',
    goToRememberedPlace: 'Going to saved place',
    goToSurface: 'Returning to the surface',
    nearbyBlocks: 'Checking nearby blocks',
    placeBlockAt: 'Placing a block',
    placeHere: 'Placing a block',
    searchForBlock: 'Searching for blocks',
    searchForEntity: 'Searching for an entity',
    searchMemory: 'Searching memory',
    searchSkills: 'Searching known skills',
    searchWiki: 'Searching the Minecraft wiki',
    smeltItem: 'Smelting',
    tradeWithVillager: 'Trading with a villager',
    useOn: 'Using an item'
};

function asBoolean(value, fallback) {
    if (value === undefined || value === null || value === '')
        return fallback;
    if (typeof value === 'boolean')
        return value;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function shortText(value, maxLength = 110) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function toolSubject(args = {}) {
    if (!args || typeof args !== 'object')
        return '';
    const value = args.query ?? args.recipe_name ?? args.item_name ?? args.block_name ??
        args.entity_name ?? args.player_name ?? args.name ?? args.task;
    return value ? `: ${shortText(value, 55)}` : '';
}

export function formatToolProgress(call) {
    const name = call?.name || 'tool';
    return `${TOOL_LABELS[name] || `Using ${name}`}${toolSubject(call?.arguments)}`;
}

export class ProgressReporter {
    constructor(agent, overrides = {}) {
        this.agent = agent;
        this.enabled = asBoolean(overrides.enabled ?? settings.progress_chat, true);
        this.showTools = asBoolean(overrides.showTools ?? settings.progress_chat_show_tools, true);
        this.showPlans = asBoolean(overrides.showPlans ?? settings.progress_chat_show_plans, true);
        this.minIntervalMs = Number(overrides.minIntervalMs ?? settings.progress_chat_min_interval_ms) || 2500;
        this.thinkingIntervalMs = Number(overrides.thinkingIntervalMs ?? settings.progress_chat_interval_ms) || 12000;
        this.maxLength = Number(overrides.maxLength ?? settings.progress_chat_max_length) || 120;
        this.prefix = overrides.prefix ?? settings.progress_chat_prefix ?? '› ';
        this.lastSentAt = 0;
        this.lastMessage = '';
        this.pendingMessage = null;
        this.pendingTimer = null;
    }

    report(message, { force = false } = {}) {
        if (!this.enabled || !message)
            return;

        const cleaned = shortText(message, this.maxLength);
        if (!cleaned || cleaned === this.lastMessage)
            return;

        const wait = this.minIntervalMs - (Date.now() - this.lastSentAt);
        if (!force && wait > 0) {
            this.pendingMessage = cleaned;
            if (!this.pendingTimer) {
                this.pendingTimer = setTimeout(() => {
                    this.pendingTimer = null;
                    const pending = this.pendingMessage;
                    this.pendingMessage = null;
                    if (pending)
                        this._send(pending);
                }, wait);
                this.pendingTimer.unref?.();
            }
            return;
        }

        this.pendingMessage = null;
        if (this.pendingTimer) {
            clearTimeout(this.pendingTimer);
            this.pendingTimer = null;
        }
        this._send(cleaned);
    }

    plan(message) {
        if (this.showPlans)
            this.report(`Plan: ${message}`);
    }

    tool(call) {
        if (this.showTools)
            this.report(formatToolProgress(call));
    }

    startThinking(topic = 'the next move') {
        if (!this.enabled)
            return () => {};
        const subject = shortText(topic, 75);
        const phases = [
            `Planning: ${subject}`,
            'Checking risks and required resources',
            'Choosing the next safe action'
        ];
        let phase = 0;
        this.report(phases[phase]);
        const timer = setInterval(() => {
            phase = (phase + 1) % phases.length;
            this.report(phases[phase]);
        }, this.thinkingIntervalMs);
        timer.unref?.();
        return () => clearInterval(timer);
    }

    _send(message) {
        this.lastSentAt = Date.now();
        this.lastMessage = message;
        Promise.resolve(this.agent?.openChat?.(`${this.prefix}${message}`)).catch(error => {
            console.warn('[ProgressReporter] Could not send progress:', error?.message || error);
        });
    }
}

export default ProgressReporter;
