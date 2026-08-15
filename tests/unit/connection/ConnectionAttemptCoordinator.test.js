'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ConnectionAttemptCoordinator = require('../../../src/connection/ConnectionAttemptCoordinator');

test('connection attempt coordinator holds the global gate for the whole handshake', async () => {
    const coordinator = new ConnectionAttemptCoordinator({
        minSpacingMs: 0,
        postSuccessSpacingMs: 0,
        transientFailureCooldownMs: 20,
        logger: { debug() {} }
    });

    const first = await coordinator.acquireTurn({ botId: 'bot-01' });
    let secondResolved = false;
    const secondPending = coordinator.acquireTurn({ botId: 'bot-02' }).then(value => {
        secondResolved = true;
        return value;
    });

    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(secondResolved, false, 'bot-02 must not handshake while bot-01 owns the gate');

    const releasedAt = Date.now();
    first.release({ outcome: 'failure', failureClass: 'pre-spawn-disconnect' });
    const second = await secondPending;
    assert.ok(Date.now() - releasedAt >= 15, 'failure cooldown must delay the next bot after release');
    second.release({ outcome: 'success' });
});

test('connection attempt coordinator exposes stronger cooldowns for server rate limits', () => {
    const coordinator = new ConnectionAttemptCoordinator({
        transientFailureCooldownMs: 15000,
        connectionResetCooldownMs: 20000,
        lostConnectionCooldownMs: 21000,
        loginTooFastCooldownMs: 30000
    });
    assert.equal(coordinator.cooldownForFailure('pre-spawn-disconnect'), 15000);
    assert.equal(coordinator.cooldownForFailure('connection-reset'), 20000);
    assert.equal(coordinator.cooldownForFailure('lost-connection'), 21000);
    assert.equal(coordinator.cooldownForFailure('login-too-fast'), 30000);
});
