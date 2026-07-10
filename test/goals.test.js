import test from 'node:test';
import assert from 'node:assert/strict';
import { Goals } from '../src/agent/goals/goals.js';

test('goals upsert, persist checklist state and choose highest incomplete priority', () => {
    const goals = new Goals();
    goals.addGoal('Prepare', 'Get ready', 5, ['food', 'armor']);
    goals.addGoal('Dragon', 'Defeat the dragon', 10, []);
    goals.markChecklistItem('Prepare', 'food', true);
    goals.addGoal('Prepare', 'Get fully ready', 7);

    assert.equal(goals.listGoals().length, 2);
    assert.equal(goals.getGoal('Prepare').goal_description, 'Get fully ready');
    assert.equal(goals.getGoal('Prepare').check_list[0].completed, true);
    assert.equal(goals.getHighestPriorityIncompleteGoal().name, 'Dragon');

    goals.completeGoal('Dragon');
    assert.equal(goals.getHighestPriorityIncompleteGoal().name, 'Prepare');

    const restored = Goals.fromJSON(JSON.parse(JSON.stringify(goals.listGoals())));
    assert.equal(restored.getGoal('Prepare').check_list[0].completed, true);
    assert.match(restored.listFormattedGoal('Prepare'), /\[x\] food/);
});
