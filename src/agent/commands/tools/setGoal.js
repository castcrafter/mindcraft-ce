import BaseTool from '../base_tool.js';
import CommandProperty from '../property.js';

class SetGoalTool extends BaseTool {
    constructor() {
        super(
            'setGoal',
            'Set a persistent primary goal and let the bot work on it autonomously across restarts.',
            [
                new CommandProperty('name', 'Short name of the goal.', 'string', true),
                new CommandProperty('description', 'Detailed success criteria for the goal.', 'string', false),
                new CommandProperty('priority', 'Goal priority; higher runs first (default 100).', 'integer', false),
                new CommandProperty('checklist', 'Optional JSON array of milestone strings.', 'string', false)
            ],
            false
        );
    }

    execute(agent, name, description, priority, checklist) {
        if (!agent.brainAgent)
            return 'Persistent goals require use_brain_agent=true.';

        let items = [];
        if (Array.isArray(checklist)) {
            items = checklist.map(String);
        } else if (checklist) {
            try {
                const parsed = JSON.parse(checklist);
                if (!Array.isArray(parsed))
                    return 'Checklist must be a JSON array of strings.';
                items = parsed.map(String);
            } catch (error) {
                return `Invalid checklist JSON: ${error.message}`;
            }
        }

        const goal = agent.brainAgent.setPrimaryGoal(
            name,
            description || name,
            Number(priority) || 100,
            items
        );
        if (!goal)
            return 'Could not create the goal.';

        agent.scheduleGoalContinuation?.(null, 500);
        return `Persistent goal set: ${goal.name}. Autonomous work is enabled.`;
    }
}

export default SetGoalTool;
