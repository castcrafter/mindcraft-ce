import BaseTool from '../base_tool.js';

class GoalStatusTool extends BaseTool {
    constructor() {
        super('goalStatus', 'Show persistent goals, autonomy state, and the running task checkpoint.', [], false);
    }

    execute(agent) {
        if (!agent.brainAgent)
            return 'Persistent goals require use_brain_agent=true.';
        const status = agent.brainAgent.getStatus();
        const task = agent.stateStore?.getPendingTask();
        return `${agent.brainAgent.goals.listFormattedGoals()}\n` +
            `Active goal: ${status.active_goal || 'none'}\n` +
            `Autonomy: ${status.autonomy.enabled ? (status.autonomy.paused ? 'paused' : 'running') : 'disabled'}\n` +
            `Task checkpoint: ${task ? `${task.description} (step ${task.step || 0})` : 'none'}`;
    }
}

export default GoalStatusTool;
