import * as Mindcraft from './src/mindcraft/mindcraft.js';
import settings from './settings.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFileSync } from 'fs';

function parseJsonEnv(name, fallback) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    try {
        return JSON.parse(raw);
    } catch (error) {
        console.error(`Ignoring invalid ${name}: ${error.message}`);
        return fallback;
    }
}

function parseBooleanEnv(name, fallback = false) {
    const raw = process.env[name];
    if (raw === undefined)
        return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

function parseArguments() {
    return yargs(hideBin(process.argv))
        .option('profiles', {
            type: 'array',
            describe: 'List of agent profile paths',
        })
        .option('task_path', {
            type: 'string',
            describe: 'Path to task file to execute'
        })
        .option('task_id', {
            type: 'string',
            describe: 'Task ID to execute'
        })
        .help()
        .alias('help', 'h')
        .parse();
}
const args = parseArguments();
if (args.profiles) {
    settings.profiles = args.profiles;
}
if (args.task_path) {
    let tasks = JSON.parse(readFileSync(args.task_path, 'utf8'));
    if (args.task_id) {
        settings.task = tasks[args.task_id];
        settings.task.task_id = args.task_id;
    }
    else {
        throw new Error('task_id is required when task_path is provided');
    }
}

// these environment variables override certain settings
if (process.env.MINECRAFT_PORT) {
    settings.port = Number(process.env.MINECRAFT_PORT);
}
if (process.env.MINDSERVER_PORT) {
    settings.mindserver_port = Number(process.env.MINDSERVER_PORT);
}
if (process.env.PROFILES) {
    const profiles = parseJsonEnv('PROFILES', null);
    if (Array.isArray(profiles) && profiles.length > 0)
        settings.profiles = profiles;
}
if (process.env.INSECURE_CODING) {
    settings.allow_insecure_coding = parseBooleanEnv('INSECURE_CODING');
}
if (process.env.BLOCKED_ACTIONS) {
    const blockedActions = parseJsonEnv('BLOCKED_ACTIONS', null);
    if (Array.isArray(blockedActions))
        settings.blocked_actions = blockedActions;
}
if (process.env.MAX_MESSAGES) {
    settings.max_messages = Number(process.env.MAX_MESSAGES);
}
if (process.env.NUM_EXAMPLES) {
    settings.num_examples = Number(process.env.NUM_EXAMPLES);
}
if (process.env.LOG_ALL) {
    settings.log_all_prompts = parseBooleanEnv('LOG_ALL');
}

Mindcraft.init(true, settings.mindserver_port, settings.auto_open_ui);

for (let profile of settings.profiles) {
    const profile_json = JSON.parse(readFileSync(profile, 'utf8'));
    settings.profile = profile_json;
    Mindcraft.createAgent(settings);
}
