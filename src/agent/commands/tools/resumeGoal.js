import BaseTool from '../base_tool.js';

class ResumeGoalTool extends BaseTool {
    constructor() {
        super('resumeGoal', 'Resume autonomous work on the active persistent goal.', [], false);
    }

    execute(agent) {
        if (!agent.brainAgent)
            return 'Persistent goals require use_brain_agent=true.';
        if (!agent.brainAgent.resumeAutonomy())
            return 'There is no active goal to resume.';
        agent.scheduleGoalContinuation?.(null, 500);
        return `Autonomous work resumed for: ${agent.brainAgent.active_goal}.`;
    }
}

export default ResumeGoalTool;
