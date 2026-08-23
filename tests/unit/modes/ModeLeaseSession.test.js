'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ModeCoordinator = require('../../../src/modes/ModeCoordinator');
const ModeLeaseSession = require('../../../src/modes/ModeLeaseSession');

async function fixture() {
    let id = 0;
    const coordinator = new ModeCoordinator({ botId: 'bot-01', idFactory: () => `lease-${++id}` });
    await coordinator.initialize();
    await coordinator.start();
    const session = new ModeLeaseSession({ modeId: 'fishing', modeCoordinator: coordinator, requestedResources: ['primary-mode'] });
    return { coordinator, session };
}

test('ModeLeaseSession owns exact acquire/pause/resume/release identity without changing coordinator semantics', async () => {
    const { coordinator, session } = await fixture();
    const acquired = session.acquire({ reason: 'test' });
    assert.equal(acquired.success, true);
    assert.equal(session.leaseId(), 'lease-1');
    assert.equal(session.isHeld(), true);
    assert.equal(session.pause().success, true);
    assert.equal(session.status().state, 'PAUSED');
    assert.equal(session.resume().success, true);
    assert.equal(session.status().state, 'ACTIVE');
    assert.equal(session.release().success, true);
    assert.equal(session.leaseId(), null);
    assert.equal(coordinator.owner(), null);
});

test('ModeLeaseSession fails closed when its local lease is stale and identifies external release', async () => {
    const { coordinator, session } = await fixture();
    session.acquire();
    const snapshot = session.current();
    assert.equal(session.matchesRelease({ type: 'released', lease: snapshot }), true);
    assert.equal(coordinator.release('fishing', snapshot).success, true);
    assert.equal(session.isHeld(), false);
    const stalePause = session.pause();
    assert.equal(stalePause.success, false);
    assert.equal(stalePause.status, 'BUSY');
    const cleanup = session.release();
    assert.equal(cleanup.success, true);
    assert.equal(session.leaseId(), null);
});
