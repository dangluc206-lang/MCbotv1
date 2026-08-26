'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { RuntimeWorkloadMetrics, percentile } = require('../../../src/diagnostics/metrics/RuntimeWorkloadMetrics');
const { validate } = require('../../../scripts/measure-live-workload');

test('runtime workload metrics aggregate counters and exact p50/p95/p99 durations', () => {
    let now = 0;
    const metrics = new RuntimeWorkloadMetrics({ clock: () => now, maxSamplesPerOperation: 64 });
    for (let index = 1; index <= 40; index += 1) {
        const tracker = metrics.start('storage.withdraw');
        tracker.increment('clickCount', 2);
        tracker.increment('reconcileReadCount', 3);
        now += index;
        tracker.finish('SUCCESS');
    }
    const result = metrics.snapshot().operations['storage.withdraw'];
    assert.equal(result.sampleCount, 40);
    assert.deepEqual(result.durationMs, { min: 1, p50: 20, p95: 38, p99: 40, max: 40 });
    assert.deepEqual(result.counters, { clickCount: 80, reconcileReadCount: 120 });
    assert.equal(percentile([1, 2, 3, 4], 0.95), 4);
});

test('live workload validation rejects synthetic-only or undersampled evidence', () => {
    const operation = { sampleCount: 30, durationMs: { p50: 1, p95: 2, p99: 3 }, sources: { live: 30 } };
    const valid = { contract: 'mcbot-runtime-workload-metrics/v1', operations: {
        'gui.click': operation, 'storage.withdraw': operation, 'b5.cycle': operation
    } };
    assert.equal(validate(valid).status, 'PASS');
    const synthetic = JSON.parse(JSON.stringify(valid));
    synthetic.operations['gui.click'].sources = { synthetic: 100 };
    assert.equal(validate(synthetic).status, 'FAIL');
});
