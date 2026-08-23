'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { measure, validateBaseline, parseCounts } = require('../../../scripts/measure-scale-baseline');

test('scale baseline parser is deterministic and rejects an empty effective count list', () => {
    assert.deepEqual(parseCounts('32,1,8,8'), [1, 8, 32]);
    assert.throws(() => parseCounts('0,-1,nope'), /positive integers/);
});

test('scale baseline measures current core primitives without inventing a WP-500 driver', async () => {
    const baseline = await measure({ counts: '1,4', componentsPerRuntime: 3, eventsPerBot: 3 });
    assert.equal(baseline.schema, 'mcbot-scale-baseline/v1');
    assert.deepEqual(baseline.workload.counts, [1, 4]);
    assert.equal(baseline.measurements[1].events.totalEvents, 12);
    assert.equal(baseline.measurements[1].events.deliveredToTarget, 12);
    assert.equal(baseline.crashIsolation.tested, true);
    assert.equal(baseline.crashIsolation.blastRadiusRuntimes, 1);
    assert.equal(baseline.crashIsolation.isolationObserved, true);
    assert.equal(baseline.decisionInput.measurableDriverPresent, false);
    assert.equal(baseline.decisionInput.recommendedWp500State, 'DEFERRED_NO_DRIVER');
    assert.deepEqual(validateBaseline(baseline), []);
});

test('scale baseline validation fails closed on event loss or speculative worker activation', () => {
    const fixture = {
        schema: 'mcbot-scale-baseline/v1', schemaVersion: 1,
        measurements: [{ botCount: 8, lifecycle: { startRejected: 0 }, events: { totalEvents: 10, deliveredToTarget: 9 } }],
        crashIsolation: { tested: true, isolationObserved: true },
        decisionInput: { measurableDriverPresent: true, recommendedWp500State: 'GO' }
    };
    const failures = validateBaseline(fixture);
    assert.ok(failures.some(entry => entry.code === 'SCALE_BASELINE_EVENT_LOSS'));
    assert.ok(failures.some(entry => entry.code === 'SCALE_BASELINE_DECISION_OVERREACH'));
});
