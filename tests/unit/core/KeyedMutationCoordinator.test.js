'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const KeyedMutationCoordinator = require('../../../src/core/KeyedMutationCoordinator');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

test('same mutation key serializes while different keys remain independent', async () => {
    const coordinator = new KeyedMutationCoordinator();
    const hold = deferred();
    const order = [];

    const first = coordinator.run('profile-set', async () => {
        order.push('first-start');
        await hold.promise;
        order.push('first-end');
    });
    const second = coordinator.run('profile-set', async () => { order.push('second'); });
    const independent = coordinator.run('collector', async () => { order.push('independent'); });

    await independent;
    assert.deepEqual(order, ['first-start', 'independent']);
    hold.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(order, ['first-start', 'independent', 'first-end', 'second']);
});

test('failed mutation rejects its caller but does not poison later work on the same key', async () => {
    const warnings = [];
    const coordinator = new KeyedMutationCoordinator({ logger: { warn: (...args) => warnings.push(args) } });
    await assert.rejects(coordinator.run('profile-set', async () => { throw new Error('boom'); }), /boom/);
    const value = await coordinator.run('profile-set', async () => 42);
    assert.equal(value, 42);
    assert.equal(warnings.length, 1);
});

test('drain waits work that was already accepted', async () => {
    const coordinator = new KeyedMutationCoordinator();
    const hold = deferred();
    let settled = false;
    const task = coordinator.run('profile-set', async () => { await hold.promise; settled = true; });
    const drain = coordinator.drain();
    await Promise.resolve();
    assert.equal(settled, false);
    hold.resolve();
    await drain;
    assert.equal(settled, true);
    await task;
    assert.deepEqual(coordinator.activeKeys(), []);
});
