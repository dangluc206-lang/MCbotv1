'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createB1MaterialOperation, ALLOWED_ACTIONS } = require('../../../src/server-features/storage/b1/B1MaterialOperation');
const Operation = require('../../../src/operations/Operation');

function fakeContext({ connectionGeneration = 7, token = 'tok' } = {}) {
    return { cancellation: { token }, connectionGeneration };
}

test('wraps protectForB5Batch with generation passthrough and extra args', async () => {
    const calls = [];
    const b1Materials = {
        async protectForB5Batch(args) { calls.push(args); return { success: true, data: {} }; }
    };
    const operation = createB1MaterialOperation({
        name: 'B5StorageProtectionBoundary',
        b1Materials,
        action: 'protectForB5Batch',
        args: { batchId: 'b1', trigger: 't', episodeId: 'e1' }
    });
    assert.ok(operation instanceof Operation);
    assert.equal(operation.name, 'B5StorageProtectionBoundary');
    const context = fakeContext();
    const result = await operation.executor(context);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cancellationToken, 'tok');
    assert.equal(calls[0].operationContext, context);
    assert.equal(calls[0].expectedGeneration, 7);
    assert.equal(calls[0].batchId, 'b1');
    assert.equal(calls[0].trigger, 't');
    assert.equal(calls[0].episodeId, 'e1');
    assert.deepEqual(result, { success: true, data: {} });
});

test('wraps preprocessForCraft without extra args', async () => {
    const calls = [];
    const b1Materials = {
        async preprocessForCraft(args) { calls.push(args); return { success: true }; }
    };
    const operation = createB1MaterialOperation({
        name: 'B5PostCraftSmelting',
        b1Materials,
        action: 'preprocessForCraft'
    });
    const context = fakeContext();
    await operation.executor(context);
    assert.deepEqual(Object.keys(calls[0]).sort(), ['cancellationToken', 'expectedGeneration', 'operationContext']);
});

test('rejects invalid factory inputs', () => {
    const b1Materials = { async protectForB5Batch() { return { success: true }; } };
    assert.throws(() => createB1MaterialOperation(), TypeError);
    assert.throws(() => createB1MaterialOperation({ name: '', b1Materials, action: 'protectForB5Batch' }), TypeError);
    assert.throws(() => createB1MaterialOperation({ name: 'x', b1Materials: null, action: 'protectForB5Batch' }), TypeError);
    assert.throws(() => createB1MaterialOperation({ name: 'x', b1Materials: {}, action: 'protectForB5Batch' }), TypeError);
    assert.throws(() => createB1MaterialOperation({ name: 'x', b1Materials, action: 'arbitraryMethod' }), TypeError);
    assert.throws(() => createB1MaterialOperation({ name: 'x', b1Materials, action: undefined }), TypeError);
    assert.deepEqual(ALLOWED_ACTIONS, ['protectForB5Batch', 'preprocessForCraft']);
});
