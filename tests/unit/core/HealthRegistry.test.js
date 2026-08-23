'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const HealthRegistry = require('../../../src/core/HealthRegistry');

test('HealthRegistry aggregates critical and degraded probes', async () => {
    const registry = new HealthRegistry({ botId: 'bot-01', probeTimeoutMs: 100 });
    registry.register('connection', () => ({ state: 'HEALTHY' }), { critical: true });
    registry.register('mode', () => ({ state: 'DEGRADED', message: 'retrying' }));
    let snapshot = await registry.snapshot();
    assert.equal(snapshot.state, 'DEGRADED');
    assert.equal(snapshot.checks.length, 2);
    registry.register('storage', () => ({ state: 'UNHEALTHY' }), { critical: true });
    snapshot = await registry.snapshot();
    assert.equal(snapshot.state, 'UNHEALTHY');
});
