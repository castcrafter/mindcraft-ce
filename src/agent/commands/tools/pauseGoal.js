import BaseTool from '../base_tool.js';

class PauseGoalTool extends BaseTool {
    constructor() {
        super('pauseGoal', 'Pause autonomous work while preserving the goal and task memory.', [], false);
    }

    execute(agent) {
        if (!agent.brainAgent)
            return 'Persistent goals require use_brain_agent=true.';
        agent.brainAgent.pauseAutonomy();
        agent.taskAgent?.cancelTask();
        return 'Autonomous goal work paused. State has been preserved.';
    }
}

export default PauseGoalTool;
