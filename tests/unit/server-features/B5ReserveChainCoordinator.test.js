'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const B5ReserveChainCoordinator = require('../../../src/server-features/crafting/b5/B5ReserveChainCoordinator');

test('B3 completion compacts the active B1 type before the reserve chain continues', async () => {
    const calls = [];
    let b2Count = 16;

    const coordinator = new B5ReserveChainCoordinator({
        flows: {
            withdraw: { async withdraw() { throw new Error('withdraw should not run'); } },
            deposit: { async deposit() { calls.push('deposit'); } }
        },
        b1Inventory: {
            async compactAfterB3(chain) {
                calls.push(`compact:${chain.baseId}`);
                return { baseId: chain.baseId, skipped: false, ready: true };
            },
            async acquire() {
                throw new Error('B2 acquisition should not run after B3 completes');
            }
        },
        intermediate: {
            async ensureFreeIntermediateSlots() {
                throw new Error('slot freeing should not run');
            }
        },
        inventoryState: {
            snapshot() {
                return { emptySlotCount: 6 };
            },
            allEnabled(key) {
                return key === 'useAllForB3';
            },
            actualCrafts() {
                return 1;
            }
        },
        inventoryCounter: {
            count(_snapshot, id) {
                return id === 'refined_coal' ? b2Count : 0;
            }
        },
        progressTracker: {
            set() {}
        },
        finalCraft: {
            async craft(recipeId, quantity) {
                calls.push(`craft:${recipeId}:${quantity}`);
                b2Count = 0;
                return { success: true, data: { actualCrafts: 1 } };
            }
        },
        config: {
            b3AllMinEmptySlots: 1,
            inventorySafetyEmptySlots: 2
        },
        runStep(_context, _meta, action) {
            return action();
        },
        childOptions(_context, extra = {}) {
            return extra;
        }
    });

    const result = await coordinator.prepare({
        baseId: 'coal',
        b2Id: 'refined_coal',
        b3Id: 'refined_coal_block',
        b3RecipeId: 'refined_coal_block_recipe',
        b3InputPerCraft: 16,
        b2Crafts: 0,
        b3Crafts: 1
    }, {
        cancellation: { token: { throwIfCancelled() {} } },
        trace: { id: 'test' }
    }, { deferIntermediateDeposit: true });

    assert.equal(result.b3Id, 'refined_coal_block');
    assert.deepEqual(calls, ['craft:refined_coal_block_recipe:ALL', 'compact:coal']);
});
