'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const B5StorageFlow = require('../../../src/server-features/crafting/b5/flows/B5StorageFlow');

test('finalizeBase does not compact the same B1 twice after a B3 boundary', async () => {
    let compactCalls = 0;
    const b1Materials = {
        storage: null,
        logger: null,
        resources: { coal: { baseId: 'coal', blockId: 'coal_block', ratio: 9 } },
        async ensureBaseAvailable() {
            return { success: true, data: { ready: true, available: 16 } };
        },
        async compact(baseId) {
            compactCalls += 1;
            return { success: true, data: { baseId, converted: true } };
        }
    };
    const flow = new B5StorageFlow({ b1Materials });
    const options = {
        expectedGeneration: 1,
        operationContext: { operationId: 'b5-test-operation', connectionGeneration: 1 }
    };

    const prepared = await flow.prepareBase('coal', 16, options);
    assert.equal(prepared.success, true);
    assert.equal(prepared.data.ready, true);

    const first = await flow.finalizeBase('coal', options);
    const second = await flow.finalizeBase('coal', options);

    assert.equal(first.success, true);
    assert.equal(second.success, true);
    assert.equal(second.data.skipped, true);
    assert.equal(second.data.reason, 'already-finalized-in-current-operation');
    assert.equal(compactCalls, 1);
});

test('a new prepareBase transaction allows a later compaction for the same B1 type', async () => {
    let compactCalls = 0;
    const b1Materials = {
        storage: null,
        logger: null,
        resources: { coal: { baseId: 'coal', blockId: 'coal_block', ratio: 9 } },
        async ensureBaseAvailable() {
            return { success: true, data: { ready: true, available: 16 } };
        },
        async compact(baseId) {
            compactCalls += 1;
            return { success: true, data: { baseId, converted: true } };
        }
    };
    const flow = new B5StorageFlow({ b1Materials });
    const options = {
        expectedGeneration: 1,
        operationContext: { operationId: 'b5-test-operation-2', connectionGeneration: 1 }
    };

    await flow.prepareBase('coal', 16, options);
    await flow.finalizeBase('coal', options);
    await flow.prepareBase('coal', 16, options);
    await flow.finalizeBase('coal', options);

    assert.equal(compactCalls, 2);
});
