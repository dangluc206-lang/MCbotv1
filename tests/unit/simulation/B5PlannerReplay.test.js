'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B5ExecutionPlanner = require('../../../src/planning/crafting/B5ExecutionPlanner');
const B5PlannerReplay = require('../../../src/simulation/b5/B5PlannerReplay');
const fixture = require('../../fixtures/replay/b5-planner-basic.json');

test('B5 planner replay reproduces the expected next decision and blockers', () => {
    const replay = new B5PlannerReplay({ planner: new B5ExecutionPlanner() });
    const result = replay.replay(fixture);
    assert.equal(result.success, true, result.mismatches.join('; '));
    assert.equal(result.plan.decision.kind, fixture.expected.decisionKind);
});
