import BaseTool from '../base_tool.js';
import CommandProperty from '../property.js';

class ClearGoalTool extends BaseTool {
    constructor() {
        super(
            'clearGoal',
            'Remove a persistent goal. If no name is provided, remove the active goal.',
            [new CommandProperty('name', 'Goal name to remove.', 'string', false)],
            false
        );
    }

    execute(agent, name) {
        if (!agent.brainAgent)
            return 'Persistent goals require use_brain_agent=true.';
        const target = name || agent.brainAgent.active_goal;
        if (!target)
            return 'There is no active goal.';
        agent.taskAgent?.cancelTask();
        return agent.brainAgent.clearGoal(target)
            ? `Goal removed: ${target}.`
            : `Goal not found: ${target}.`;
    }
}

export default ClearGoalTool;
