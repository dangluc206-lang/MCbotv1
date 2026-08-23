'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B5ExecutionPlanner = require('../../../src/planning/crafting/B5ExecutionPlanner');
const fixture = require('../../fixtures/replay/b5-planner-basic.json');

test('B5 Execution Planner produces deterministic decision and digest', () => {
    const planner = new B5ExecutionPlanner();
    const first = planner.compile(fixture.inspection);
    const second = planner.compile(JSON.parse(JSON.stringify(fixture.inspection)));
    assert.equal(first.decision.kind, 'B2/B3');
    assert.equal(first.decision.resource, 'refined_coal');
    assert.equal(first.snapshotDigest, second.snapshotDigest);
    assert.ok(first.blockers.some(entry => entry.reason === 'missing-material' && entry.resource === 'diamond'));
});

test('B5 Execution Planner exposes decompression headroom as an explicit blocker', () => {
    const planner = new B5ExecutionPlanner();
    const inspection = JSON.parse(JSON.stringify(fixture.inspection));
    inspection.fullPlan.missing = {};
    inspection.chains = [{ baseId: 'diamond', decompressionBlocked: true, missingRaw: 0, immediateMissingRaw: 64, storedEffective: 0, storedTotalEffective: 640 }];
    inspection.progress.nextStep = { kind: 'PREPARE_B1', id: 'diamond', reason: 'decompression-headroom' };
    const plan = planner.compile(inspection);
    assert.equal(plan.decision.kind, 'PREPARE_B1');
    assert.ok(plan.blockers.some(entry => entry.reason === 'decompression-headroom' && entry.resource === 'diamond'));
});


test('B5 Execution Planner emits a self-contained replay fixture input', () => {
    const planner = new B5ExecutionPlanner();
    const inspection = {
        amount: 1,
        storage: { items: { coal: 1024 }, capacity: { used: 200, free: 800, limit: 1000 } },
        personalVault: { totals: { coal_b2: 4 } },
        inventoryTotals: {},
        personalVaultPressure: { critical: false },
        fullPlan: { targetId: 'b5', feasible: false, missing: { diamond: 32 }, steps: [] },
        chains: [],
        progress: { targetId: 'b5', amount: 1, feasible: false, state: 'WAITING_MATERIALS', nextStep: { kind: 'B2/B3', id: 'coal_b3', b2Id: 'coal_b2' } }
    };
    const plan = planner.compile(inspection);
    const fixture = planner.toReplayFixture(plan);
    const replayed = planner.compile(fixture.inspection);
    assert.equal(replayed.snapshotDigest, plan.snapshotDigest);
    assert.deepEqual(replayed.decision, plan.decision);
    assert.deepEqual(replayed.blockers, plan.blockers);
});
