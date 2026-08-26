'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const SharedResourceLeaseRegistry = require('../../../src/core/resources/SharedResourceLeaseRegistry');

test('shared resource leases serialize owners FIFO and isolate different physical resources', async () => {
    const registry = new SharedResourceLeaseRegistry();
    const first = await registry.acquire('storage:island-a', { owner: 'bot-01' });
    let secondGranted = false;
    const secondPromise = registry.acquire('storage:island-a', { owner: 'bot-02' }).then(lease => {
        secondGranted = true;
        return lease;
    });
    const independent = await registry.acquire('storage:island-b', { owner: 'bot-03' });
    await Promise.resolve();
    assert.equal(secondGranted, false);
    assert.equal(registry.status().resources['storage:island-a'].queued[0].owner, 'bot-02');
    assert.equal(first.release('batch-complete'), true);
    const second = await secondPromise;
    assert.equal(secondGranted, true);
    assert.equal(second.release(), true);
    assert.equal(second.release(), false, 'release is idempotent');
    independent.release();
    assert.deepEqual(registry.status(), { resources: {} });
});

test('cancelled queued lease never becomes the active owner', async () => {
    const registry = new SharedResourceLeaseRegistry();
    const first = await registry.acquire('storage:shared', { owner: 'bot-01' });
    let cancel;
    const token = {
        throwIfCancelled() {},
        onCancelled(listener) { cancel = listener; return () => { cancel = null; }; }
    };
    const pending = registry.acquire('storage:shared', { owner: 'bot-02', cancellationToken: token });
    cancel('mode-disabled');
    await assert.rejects(pending, error => error.code === 'CANCELLED');
    first.release();
    assert.deepEqual(registry.status(), { resources: {} });
});
