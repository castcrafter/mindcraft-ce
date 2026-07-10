import { Agent } from '../agent/agent.js';
import { serverProxy } from '../agent/mindserver_proxy.js';
import yargs from 'yargs';

const args = process.argv.slice(2);
if (args.length < 1) {
    console.log('Usage: node init_agent.js -n <agent_name> -p <port> -l <load_memory> -m <init_message> -c <count_id>');
    process.exit(1);
}

const argv = yargs(args)
    .option('name', {
        alias: 'n',
        type: 'string',
        description: 'name of agent'
    })
    .option('load_memory', {
        alias: 'l',
        type: 'boolean',
        description: 'load agent memory from file on startup'
    })
    .option('init_message', {
        alias: 'm',
        type: 'string',
        description: 'automatically prompt the agent on startup'
    })
    .option('count_id', {
        alias: 'c',
        type: 'number',
        default: 0,
        description: 'identifying count for multi-agent scenarios',
    })
    .option('port', {
        alias: 'p',
        type: 'number',
        description: 'port of mindserver'
    })
    .argv;

let activeAgent = null;
let shuttingDown = false;

function handleShutdown(signal) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    try {
        activeAgent?.stateStore?.remember('lifecycle', `Agent process received ${signal}`, {
            active_task: activeAgent?.taskAgent?.currentTaskDescription || null,
            active_goal: activeAgent?.brainAgent?.active_goal || null
        });
        activeAgent?.bot?.quit?.(`Process received ${signal}`);
    } catch (error) {
        console.error('Failed to save shutdown state:', error);
    }
    process.exit(0);
}

process.once('SIGINT', () => handleShutdown('SIGINT'));
process.once('SIGTERM', () => handleShutdown('SIGTERM'));

(async () => {
    try {
        console.log('Connecting to MindServer');
        await serverProxy.connect(argv.name, argv.port);
        console.log('Starting agent');
        activeAgent = new Agent();
        serverProxy.setAgent(activeAgent);
        await activeAgent.start(argv.load_memory, argv.init_message, argv.count_id);
    } catch (error) {
        console.error('Failed to start agent process:');
        console.error(error.message);
        console.error(error.stack);
        process.exit(1);
    }
})();
