'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const OperatorHealthService = require('../../../src/desktop/health/OperatorHealthService');

test('OperatorHealthService differentiates intentional disconnect and B5 blocked dwell', async () => {
    let now = 200000;
    let calls = 0;
    const service = new OperatorHealthService({ now: () => now, cacheTtlMs: 1000, snapshotProvider: () => {
        calls += 1;
        return { lifecycle: 'RUNNING', system: {}, bots: [
            { botId: 'off', profile: { enabled: false }, intent: { desiredConnection: 'DISCONNECTED' }, state: { connectionState: 'DISCONNECTED' } },
            { botId: 'b5', profile: { enabled: true }, intent: { desiredConnection: 'CONNECTED' }, state: { connectionState: 'CONNECTED' }, modeOwner: { modeId: 'b5-craft' }, operation: { operations: [] }, modes: { b5Craft: { details: { protectionEpisode: { state: 'WAITING_BLOCKED', lastAttemptAt: new Date(now - 70000).toISOString() } } } } }
        ] };
    } });
    const result = await service.sample();
    assert.equal(result.overall, 'UNHEALTHY');
    assert.equal(result.probes.some(entry => entry.botId === 'off' && entry.id === 'reconnect' && entry.status === 'NOT_APPLICABLE'), true);
    assert.equal(result.probes.some(entry => entry.botId === 'b5' && entry.id === 'b5-blocker-dwell' && entry.status === 'UNHEALTHY'), true);
    const cached = await service.sample();
    assert.equal(cached.cached, true);
    assert.equal(calls, 1);
});

test('OperatorHealthService bounds a stuck sampler', async () => {
    const service = new OperatorHealthService({ timeoutMs: 25, snapshotProvider: () => new Promise(() => {}) });
    const result = await service.sample();
    assert.equal(result.timedOut, true);
    assert.equal(result.overall, 'UNKNOWN');
});
