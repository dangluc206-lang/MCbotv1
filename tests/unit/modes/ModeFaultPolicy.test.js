'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ModeFaultPolicy = require('../../../src/modes/ModeFaultPolicy');

const POLICY = { baseBackoffMs: 10, maxBackoffMs: 100, multiplier: 2, jitterRatio: 0, maxConsecutiveFailures: 3, openDurationMs: 500 };

test('XP-013 common policy excludes waits, cancellation and stale aborts from finite restart budget', () => {
    const policy = new ModeFaultPolicy({ botId: 'bot-01', modeId: 'reference-mode', policy: POLICY });
    policy.record(Object.assign(new Error('cancel'), { code: 'CANCELLED' }));
    policy.record(Object.assign(new Error('stale'), { code: 'COMMAND_STALE_GENERATION' }));
    policy.record(new Error('waiting'), { expectedWait: true, code: 'MODE_EXPECTED_WAIT' });
    assert.equal(policy.snapshot().circuit.consecutiveFailures, 0);
    assert.equal(policy.restartPolicy().maxRestarts, 2);
});

test('XP-013 repeated faults open a finite bot-scoped circuit and publish one incident episode', () => {
    const events = [];
    const policy = new ModeFaultPolicy({ botId: 'bot-01', modeId: 'reference-mode', policy: POLICY, publisher: { publish: value => events.push(value) } });
    for (let attempt = 0; attempt < 3; attempt += 1) {
        policy.record(Object.assign(new Error('loop failed'), { code: 'MODE_LOOP_FAILED', retryable: true }), { episodeId: 'loop-episode' });
    }
    assert.equal(policy.snapshot().circuit.state, 'OPEN');
    assert.equal(policy.beforeAttempt().allowed, false);
    assert.equal(events.length, 1);
    assert.equal(events[0].details.faultClass, 'TRANSIENT_RETRY');
    policy.recordVerifiedSuccess({ reason: 'reference-recovered', episodeId: 'loop-episode', evidence: { verified: true } });
    assert.equal(policy.snapshot().circuit.state, 'CLOSED');
    assert.ok(policy.snapshot().episodes[0].resolvedAt);
});

test('XP-013 business blocker publishes once without consuming crash-loop budget', () => {
    const events = [];
    const policy = new ModeFaultPolicy({ botId: 'bot-01', modeId: 'reference-mode', policy: POLICY, publisher: { publish: value => events.push(value) } });
    const error = Object.assign(new Error('blocked'), { code: 'STORAGE_PROTECTION_BLOCKED' });
    policy.recordBlocker(error, { episodeId: 'storage-1' });
    policy.recordBlocker(error, { episodeId: 'storage-1' });
    assert.equal(policy.snapshot().circuit.consecutiveFailures, 0);
    assert.equal(events.length, 1);
});

test('R1 hardening reopens a resolved incident key and blocker recovery does not reset unrelated circuit failures', () => {
    const events = [];
    const policy = new ModeFaultPolicy({ botId: 'bot-01', modeId: 'reference-mode', policy: POLICY, publisher: { publish: value => events.push(value) } });
    policy.record(Object.assign(new Error('transient'), { code: 'MODE_TRANSIENT', retryable: true }), { episodeId: 'loop-1' });
    assert.equal(policy.snapshot().circuit.consecutiveFailures, 1);
    policy.recordBlocker(Object.assign(new Error('blocked'), { code: 'STORAGE_PROTECTION_BLOCKED' }), { episodeId: 'storage-stable' });
    policy.resolveEpisode('storage-stable', { verified: true });
    assert.equal(policy.snapshot().circuit.consecutiveFailures, 1);
    policy.recordBlocker(Object.assign(new Error('blocked again'), { code: 'STORAGE_PROTECTION_BLOCKED' }), { episodeId: 'storage-stable' });
    assert.equal(events.filter(value => value.details?.faultClass === 'BUSINESS_BLOCKER').length, 2);
});
