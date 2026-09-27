'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const StageExecutionContract = require('../../../src/server-features/crafting/verification/StageExecutionContract');
const CraftingVerificationService = require('../../../src/server-features/crafting/CraftingVerificationService');

function fakeVerifier() {
    return {
        before: () => ({}),
        arm: () => Date.now(),
        after: async () => ({ verified: true }),
        waitForOutputCompletion: async () => ({ completed: true }),
        settleAfterCraft: async () => ({ settled: true })
    };
}

test('slice5 parity: generic and legacy stage names share the same contract codes', () => {
    const contract = new StageExecutionContract();
    // Legacy B-stage vocabulary still enforced at the same boundary.
    assert.doesNotThrow(() => contract.requireInputReady({ stage: 'B1', logicalId: 'diamond', available: 512, required: 512 }));
    // Generic vocabulary drives the identical boundary for any target.
    assert.doesNotThrow(() => contract.requireInputReady({ stage: 'BASE', logicalId: 'titanium', available: 512, required: 512 }));
    for (const stage of ['B1', 'BASE']) {
        try {
            contract.requireInputReady({ stage, logicalId: 'x', available: 0, required: 1 });
            assert.fail('expected input-not-ready');
        } catch (error) {
            assert.equal(error.code || error.details?.code, 'CRAFT_STAGE_INPUT_NOT_READY');
            assert.equal(error.details?.subsystem || error.subsystem, 'crafting');
        }
    }
});

test('slice5 parity: handoff generation guard is vocabulary-independent', () => {
    const service = new CraftingVerificationService({ resultVerifier: fakeVerifier(), stageContract: new StageExecutionContract() });
    assert.deepEqual(
        service.handoff({ from: 'BASE', to: 'INTERMEDIATE', generation: 7, context: { connectionGeneration: 7 } }),
        { ready: true, from: 'BASE', to: 'INTERMEDIATE', generation: 7 }
    );
    assert.throws(
        () => service.handoff({ from: 'B1', to: 'B2', generation: 7, context: { connectionGeneration: 8 } }),
        /across connection generations/
    );
});

test('slice5 parity: output/settlement boundaries accept any target id', () => {
    const service = new CraftingVerificationService({ resultVerifier: fakeVerifier(), stageContract: new StageExecutionContract() });
    assert.doesNotThrow(() => service.verifyOutput({ stage: 'TARGET', logicalId: 'carbon', before: 0, after: 1, expectedDelta: 1 }));
    assert.doesNotThrow(() => service.requireSettled({ stage: 'TARGET', logicalId: 'carbon', settlement: { settled: true, count: 1 } }));
    assert.throws(() => service.verifyOutput({ stage: 'TARGET', logicalId: 'carbon', before: 0, after: 0, expectedDelta: 1 }), /not verified/);
    assert.throws(() => service.requireSettled({ stage: 'TARGET', logicalId: 'carbon', settlement: { settled: false } }), /did not settle/);
});
