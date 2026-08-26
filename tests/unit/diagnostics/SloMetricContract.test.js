'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Metric = require('../../../src/diagnostics/metrics/SloMetricContract');

test('creates bounded local metrics with allowlisted dimensions', () => {
    assert.deepEqual(Metric.create('b5_batch_outcome', 1, { outcome: 'blocked', faultClass: 'storage' }, { now: 0 }), {
        contract: 'mcbot-local-metric-v1',
        name: 'b5_batch_outcome',
        value: 1,
        unit: 'count',
        dimensions: { outcome: 'blocked', faultClass: 'storage' },
        recordedAt: '1970-01-01T00:00:00.000Z'
    });
});

test('rejects PII and unbounded metric dimensions', () => {
    assert.throws(() => Metric.create('reconnect_outcome', 1, { username: 'player' }), /Forbidden/);
    assert.throws(() => Metric.create('reconnect_outcome', 1, { message: 'raw server text' }), /Forbidden/);
    assert.throws(() => Metric.create('reconnect_outcome', 1, { botId: 'bot-01' }), /Unsupported/);
});
