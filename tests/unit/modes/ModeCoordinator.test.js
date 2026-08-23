'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ModeCoordinator = require('../../../src/modes/ModeCoordinator');
const Status = require('../../../src/shared/result/Status');

function coordinator(botId = 'bot-01') {
    let next = 0;
    let now = Date.parse('2026-08-16T00:00:00.000Z');
    return new ModeCoordinator({
        botId,
        idFactory: () => `lease-${++next}`,
        clock: () => now++
    });
}

test('ModeCoordinator atomically grants one primary-mode lease under concurrent enable requests', async () => {
    const owner = coordinator();
    const sideEffects = [];
    const enable = async modeId => {
        const result = owner.acquire(modeId, { reason: `${modeId} enable` });
        if (result.success) sideEffects.push(modeId);
        return result;
    };
    const results = await Promise.all([
        Promise.resolve().then(() => enable('collector-b5')),
        Promise.resolve().then(() => enable('fishing'))
    ]);
    assert.equal(results.filter(result => result.success).length, 1);
    assert.equal(results.filter(result => result.status === Status.BUSY).length, 1);
    assert.deepEqual(sideEffects, [results.find(result => result.success).data.modeId]);
    assert.equal(owner.owner().modeId, sideEffects[0]);
});

test('same-mode acquire is idempotent and pause keeps the primary lease', () => {
    const owner = coordinator();
    const first = owner.acquire('collector-b5');
    const repeated = owner.acquire('collector-b5');
    assert.equal(first.success, true);
    assert.equal(repeated.meta.alreadyOwned, true);
    assert.equal(repeated.data.leaseId, first.data.leaseId);
    assert.equal(owner.pause('collector-b5', first.data).success, true);
    assert.equal(owner.owner().state, 'PAUSED');
    assert.equal(owner.acquire('fishing').status, Status.BUSY);
    assert.equal(owner.resume('collector-b5', first.data).success, true);
    assert.equal(owner.owner().state, 'ACTIVE');
});

test('disable release is idempotent and stale lease cannot release a newer lease', () => {
    const owner = coordinator();
    const oldLease = owner.acquire('fishing').data;
    assert.equal(owner.release('fishing', oldLease).success, true);
    assert.equal(owner.release('fishing', oldLease).meta.alreadyReleased, true);
    const current = owner.acquire('fishing').data;
    const stale = owner.release('fishing', oldLease);
    assert.equal(stale.status, Status.INVALID_INPUT);
    assert.equal(owner.owner().leaseId, current.leaseId);
    assert.equal(owner.release('fishing', current).success, true);
    assert.equal(owner.owner(), null);
});

test('coordinators are isolated per bot and snapshots expose no mutable Map or lease state', () => {
    const first = coordinator('bot-01');
    const second = coordinator('bot-02');
    first.acquire('collector-b5', { metadata: { token: 'secret-value', nested: { role: 'worker' } } });
    second.acquire('fishing');
    assert.equal(first.owner().modeId, 'collector-b5');
    assert.equal(second.owner().modeId, 'fishing');
    const snapshot = first.snapshot();
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.leases), true);
    assert.equal(snapshot.leases[0].metadata.token, '[REDACTED]');
    assert.throws(() => snapshot.leases.push({}), TypeError);
    assert.equal('leasesByMode' in snapshot, false);
    assert.equal('resourceOwners' in snapshot, false);
});

test('lifecycle stop releases all leases, notifies observers, and blocks new acquire until initialize', async () => {
    const owner = coordinator();
    const changes = [];
    const off = owner.onChange(change => changes.push(change));
    await owner.initialize();
    await owner.start();
    owner.acquire('collector-b5');
    await owner.stop();
    assert.equal(owner.owner(), null);
    assert.equal(changes.some(change => change.type === 'released' && change.reason === 'coordinator-stop'), true);
    assert.equal(owner.acquire('fishing').status, Status.NOT_READY);
    await owner.initialize();
    assert.equal(owner.acquire('fishing').success, true);
    off();
    await owner.destroy();
    assert.equal(owner.snapshot().lifecycleState, 'DESTROYED');
});

test('listener failures are isolated from lease mutation and later observers still run', () => {
    const warnings = [];
    const owner = new ModeCoordinator({
        botId: 'bot-01',
        idFactory: () => 'lease-fixed',
        logger: { warn: (...args) => warnings.push(args) }
    });
    let observed = 0;
    owner.onChange(() => { throw new Error('observer failed'); });
    owner.onChange(() => { observed += 1; });
    const result = owner.acquire('fishing');
    assert.equal(result.success, true);
    assert.equal(owner.owner().modeId, 'fishing');
    assert.equal(observed, 1);
    assert.equal(warnings.length, 1);
});

test('resource claims are deterministic and an enabled mode cannot silently change them', () => {
    const owner = coordinator();
    const acquired = owner.acquire('collector-b5', {
        requestedResources: ['inventory-side-effect', 'primary-mode', 'movement']
    });
    assert.deepEqual(acquired.data.requestedResources, ['inventory-side-effect', 'movement', 'primary-mode']);
    const incompatible = owner.acquire('collector-b5', { requestedResources: ['primary-mode'] });
    assert.equal(incompatible.status, Status.INVALID_INPUT);
    assert.equal(owner.owner('movement').modeId, 'collector-b5');
});
