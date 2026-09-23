'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B5RequestExecution = require('../../../src/modes/b5-craft/B5RequestExecution');

function execution(quantity = 10, options = {}) {
    return new B5RequestExecution({
        request: { targetItemId: 'titanium', quantityMode: quantity === 'ALL' ? 'ALL' : 'FIXED', quantity: quantity === 'ALL' ? null : quantity },
        ...options
    });
}

for (const quantity of [10, 'ALL']) {
    for (const failure of [false, true]) {
        test(`${quantity}: repeated ${failure ? 'transient failures' : 'no-progress plans'} stop at the configured limit`, () => {
            const request = execution(quantity, { maxBlockedStreakForAll: 3 });
            let calls = 0;
            while (!request.isTerminal() && calls < 5) {
                assert.equal(request.nextCycle().action, 'CYCLE');
                calls += 1;
                request.record(failure
                    ? { success: false, status: 'TIMEOUT' }
                    : { success: true, data: { productive: false } });
            }
            assert.equal(calls, 3, 'must not start a fourth cycle');
            assert.equal(request.snapshot().state, 'EXHAUSTED');
        });
    }
    test(`${quantity}: alternating progress and failure cannot evade the target-unit bound`, () => {
        const request = execution(quantity, { maxCyclesWithoutTargetUnit: 4 });
        for (let i = 0; i < 4; i += 1) {
            request.nextCycle();
            request.record({ success: true, data: { productive: i % 2 === 0 } });
        }
        assert.equal(request.snapshot().state, 'EXHAUSTED');
    });
}

test('ALL stops on initial verified material exhaustion, not on a productive partial cycle', () => {
    const request = execution('ALL');
    request.nextCycle();
    request.record({ success: true, data: { productive: false, waitingForMaterials: true } });
    assert.equal(request.snapshot().state, 'EXHAUSTED');
    assert.equal(request.snapshot().remaining, null);
    const productive = execution('ALL');
    productive.record({ success: true, data: { productive: true, waitingForMaterials: true } });
    assert.equal(productive.isTerminal(), false);
});

for (const amount of [undefined, 0, -1, 1.5, 2, Infinity, NaN]) {
    test(`invalid one-unit completion amount ${amount} fails without credit`, () => {
        const request = execution(1);
        request.record({ success: true, data: { targetId: 'titanium', completedTarget: true, completedAmount: amount } });
        assert.equal(request.snapshot().state, 'FAILED');
        assert.equal(request.snapshot().completedUnits, 0);
    });
}

test('reconciliation gates further cycles and cannot credit ordinary results', () => {
    const request = execution(1);
    request.record({ success: false, meta: { requiresReconciliation: true } });
    assert.equal(request.nextCycle().action, 'WAIT');
    request.record({ success: true, data: { targetId: 'titanium', completedTarget: true, completedAmount: 1 } });
    assert.equal(request.snapshot().completedUnits, 0);
});

test('reconciliation resolution requires current generation and verified evidence', () => {
    const request = execution(1);
    request.record({ success: false, meta: { requiresReconciliation: true } });
    const proof = { generation: 2, expectedGeneration: 2, verified: true, targetId: 'titanium', completedAmount: 1 };
    request.resolveReconciliation({ ...proof, generation: 1 });
    request.resolveReconciliation({ ...proof, verified: false });
    request.resolveReconciliation({ ...proof, generation: null, expectedGeneration: null });
    assert.equal(request.nextCycle().action, 'WAIT');
    request.resolveReconciliation(proof);
    assert.equal(request.snapshot().state, 'COMPLETED');
    request.resolveReconciliation(proof);
    assert.equal(request.snapshot().completedUnits, 1);
});

test('verified no-effect reconciliation releases the gate without resetting bounds', () => {
    const request = execution(1, { maxCyclesWithoutTargetUnit: 2 });
    for (let i = 0; i < 2; i += 1) {
        request.nextCycle();
        request.record({ success: false, meta: { requiresReconciliation: true } });
        request.resolveReconciliation({ generation: 2, expectedGeneration: 2, verified: true, completedAmount: 0 });
    }
    assert.equal(request.snapshot().completedUnits, 0);
    assert.equal(request.snapshot().state, 'EXHAUSTED');
});

test('reconciliation flag wins over apparent success or cancellation', () => {
    for (const result of [
        { success: true, data: { requiresReconciliation: true, completedTarget: true, targetId: 'titanium', completedAmount: 1 } },
        { success: false, status: 'CANCELLED', meta: { requiresReconciliation: true } }
    ]) {
        const request = execution(1);
        request.record(result);
        assert.equal(request.nextCycle().action, 'WAIT');
        assert.equal(request.snapshot().completedUnits, 0);
    }
});

for (const options of [
    { maxCyclesWithoutTargetUnit: Infinity }, { maxBlockedStreakForAll: NaN },
    { maxBlockedStreakForAll: 0 }, { maxCyclesWithoutTargetUnit: 1.5 }
]) {
    test(`invalid guard limits fail closed: ${JSON.stringify(options)}`, () => {
        assert.throws(() => execution(1, options), TypeError);
    });
}

test('only matching current-generation completion credits one additional unit', () => {
    const request = execution(1);
    const result = { success: true, data: { targetId: 'titanium', completedTarget: true, completedAmount: 1 } };
    request.record(result, { generation: 2, expectedGeneration: 1 });
    request.record({ success: true, data: { recoveredExistingB5: true, targetId: 'titanium', recoveredAmount: 10 } });
    assert.equal(request.snapshot().completedUnits, 0);
    request.record(result, { generation: 2, expectedGeneration: 2 });
    assert.equal(request.snapshot().state, 'COMPLETED');
    assert.equal(request.snapshot().completedUnits, 1);
    assert.equal(request.nextCycle().action, 'STOP');
});
