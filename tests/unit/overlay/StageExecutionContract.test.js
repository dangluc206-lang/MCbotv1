'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const StageExecutionContract = require('../../../src/server-features/crafting/verification/StageExecutionContract');

test('stage contract accepts only verified input/output and settled handoff', () => {
    const c = new StageExecutionContract();
    assert.doesNotThrow(() => c.requireInputReady({ stage: 'B1', logicalId: 'iron', available: 16, required: 16 }));
    assert.throws(() => c.requireInputReady({ stage: 'B1', logicalId: 'iron', available: 8, required: 16 }), /input is not ready/);
    assert.doesNotThrow(() => c.verifyOutput({ stage: 'B2', logicalId: 'refined_iron', before: 0, after: 64, expectedDelta: 64 }));
    assert.throws(() => c.verifyOutput({ stage: 'B2', logicalId: 'refined_iron', before: 0, after: 32, expectedDelta: 64 }), /output was not verified/);
    assert.doesNotThrow(() => c.requireSettled({ stage: 'B2', logicalId: 'refined_iron', settlement: { settled: true, count: 64 } }));
    assert.throws(() => c.requireSettled({ stage: 'B2', logicalId: 'refined_iron', settlement: { settled: false, timedOut: true } }), /did not settle/);
});

test('stage handoff rejects generation mismatch', () => {
    const c = new StageExecutionContract();
    assert.doesNotThrow(() => c.handoff({ from: 'B2', to: 'B3', generation: 7, context: { connectionGeneration: 7 } }));
    assert.throws(() => c.handoff({ from: 'B2', to: 'B3', generation: 7, context: { connectionGeneration: 8 } }), /across connection generations/);
});


test('complete B1 -> B5 handoff sequence enforces every boundary', () => {
    const c = new StageExecutionContract();
    const generation = 11;
    c.requireInputReady({ stage: 'B1', logicalId: 'raw', available: 512, required: 512, context: { connectionGeneration: generation } });
    c.handoff({ from: 'B1', to: 'B2', generation, context: { connectionGeneration: generation } });
    c.verifyOutput({ stage: 'B2', logicalId: 'b2', before: 0, after: 64, expectedDelta: 64, context: { connectionGeneration: generation } });
    c.requireSettled({ stage: 'B2', logicalId: 'b2', settlement: { settled: true, count: 64 }, context: { connectionGeneration: generation } });
    c.handoff({ from: 'B2', to: 'B3', generation, context: { connectionGeneration: generation } });
    c.verifyOutput({ stage: 'B3', logicalId: 'b3', before: 0, after: 4, expectedDelta: 4, context: { connectionGeneration: generation } });
    c.requireSettled({ stage: 'B3', logicalId: 'b3', settlement: { settled: true, count: 4 }, context: { connectionGeneration: generation } });
    c.handoff({ from: 'B3', to: 'B4', generation, context: { connectionGeneration: generation } });
    c.verifyOutput({ stage: 'B4', logicalId: 'b4', before: 0, after: 1, expectedDelta: 1, context: { connectionGeneration: generation } });
    c.requireSettled({ stage: 'B4', logicalId: 'b4', settlement: { settled: true, count: 1 }, context: { connectionGeneration: generation } });
    c.handoff({ from: 'B4', to: 'B5', generation, context: { connectionGeneration: generation } });
    c.verifyOutput({ stage: 'B5', logicalId: 'b5', before: 0, after: 1, expectedDelta: 1, context: { connectionGeneration: generation } });
    c.requireSettled({ stage: 'B5', logicalId: 'b5', settlement: { settled: true, count: 1 }, context: { connectionGeneration: generation } });
    assert.doesNotThrow(() => c.handoff({ from: 'B5', to: 'COMPLETE', generation, context: { connectionGeneration: generation } }));
});
