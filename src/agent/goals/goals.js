export class checklistItem {
    constructor(description, completed = false) {
        this.description = String(description || '').trim();
        this.completed = Boolean(completed);
    }
}

function normalizeChecklist(items = []) {
    if (!Array.isArray(items))
        return [];
    return items.map(item => {
        if (typeof item === 'string')
            return new checklistItem(item);
        return new checklistItem(item?.description, item?.completed);
    }).filter(item => item.description);
}

export class Goals {
    constructor(goals = []) {
        this.goals = [];
        this.load(goals);
    }

    static fromJSON(goals) {
        return new Goals(goals);
    }

    load(goals = []) {
        this.goals = [];
        for (const goal of Array.isArray(goals) ? goals : []) {
            if (!goal?.name)
                continue;
            this.goals.push({
                name: String(goal.name).trim(),
                priority: Number(goal.priority) || 1,
                goal_description: String(goal.goal_description || goal.description || '').trim(),
                check_list: normalizeChecklist(goal.check_list || goal.checklist),
                completed: Boolean(goal.completed),
                created_at: goal.created_at || new Date().toISOString(),
                updated_at: goal.updated_at || new Date().toISOString()
            });
        }
        return this;
    }

    addGoal(goal, goalDescription = '', priority = 1, checkList = []) {
        const name = String(goal || '').trim();
        if (!name)
            return null;

        const existing = this.getGoal(name);
        if (existing) {
            existing.priority = Number(priority) || existing.priority;
            if (goalDescription)
                existing.goal_description = String(goalDescription).trim();
            if (Array.isArray(checkList) && checkList.length > 0)
                existing.check_list = normalizeChecklist(checkList);
            existing.completed = false;
            existing.updated_at = new Date().toISOString();
            return existing;
        }

        const created = {
            name,
            priority: Number(priority) || 1,
            goal_description: String(goalDescription || '').trim(),
            check_list: normalizeChecklist(checkList),
            completed: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        this.goals.push(created);
        return created;
    }

    setPriority(goal, priority) {
        const goalObj = this.getGoal(goal);
        if (!goalObj)
            return false;
        goalObj.priority = Number(priority) || 1;
        goalObj.updated_at = new Date().toISOString();
        return true;
    }

    removeGoal(goal) {
        const before = this.goals.length;
        this.goals = this.goals.filter(item => item.name !== goal);
        return before !== this.goals.length;
    }

    completeGoal(goal, completed = true) {
        const goalObj = this.getGoal(goal);
        if (!goalObj)
            return false;
        goalObj.completed = completed;
        goalObj.updated_at = new Date().toISOString();
        return true;
    }

    listGoals() {
        return this.goals;
    }

    getGoal(goalName) {
        return this.goals.find(goal => goal.name === goalName);
    }

    getHighestPriorityIncompleteGoal() {
        return [...this.goals]
            .filter(goal => !goal.completed)
            .sort((a, b) => b.priority - a.priority)[0] || null;
    }

    listFormattedGoal(goalName) {
        const goal = this.getGoal(goalName);
        if (!goal)
            return `Goal "${goalName}" not found.`;

        let result = `- ${goal.name} (Priority: ${goal.priority}, ${goal.completed ? 'completed' : 'active'}): ${goal.goal_description}`;
        if (goal.check_list.length === 0)
            return `${result}\n  No checklist items.`;

        result += '\nChecklist:';
        for (const item of goal.check_list)
            result += `\n  - [${item.completed ? 'x' : ' '}] ${item.description}`;
        return result;
    }

    markChecklistItem(goalName, itemDescription, completed = true) {
        const goal = this.getGoal(goalName);
        if (!goal)
            return false;
        const item = goal.check_list.find(entry => entry.description === itemDescription);
        if (!item)
            return false;
        item.completed = completed;
        goal.updated_at = new Date().toISOString();
        return true;
    }

    addChecklistItem(goalName, description) {
        const goal = this.getGoal(goalName);
        const text = String(description || '').trim();
        if (!goal || !text)
            return false;
        if (!goal.check_list.some(item => item.description === text))
            goal.check_list.push(new checklistItem(text));
        goal.updated_at = new Date().toISOString();
        return true;
    }

    listFormattedGoals() {
        if (this.goals.length === 0)
            return 'No current goals.';
        return [...this.goals]
            .sort((a, b) => b.priority - a.priority)
            .map(goal => `- [${goal.completed ? 'x' : ' '}] ${goal.name} (Priority: ${goal.priority}): ${goal.goal_description}`)
            .join('\n');
    }
}
