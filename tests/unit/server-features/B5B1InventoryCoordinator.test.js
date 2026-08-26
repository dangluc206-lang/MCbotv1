'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const B5B1InventoryCoordinator = require('../../../src/server-features/crafting/b5/B5B1InventoryCoordinator');

function createHarness({
    source = 'inventory',
    configuredSource = 'inventory',
    count = 0,
    emptySlots = 6,
    prepareBase = null,
    finalizeBase = null
} = {}) {
    let inventoryCount = count;
    let slots = emptySlots;
    let acquired = null;
    let returned = 0;
    const prepareCalls = [];
    const finalizeCalls = [];
    const inventoryState = {
        count(id) { return id === 'coal' ? inventoryCount : 0; },
        spaceSnapshot() { return { emptySlotCount: slots }; }
    };
    const storageFlow = {
        async finalizeBase(id, options) {
            finalizeCalls.push({ id, options });
            if (!finalizeBase) return { success: true, data: { ready: true, converted: true } };
            return { success: true, data: { ready: true, ...finalizeBase(id, options) } };
        },
        async returnBaseInventory(id) {
            returned += inventoryCount;
            inventoryCount = 0;
            slots = emptySlots;
            return { success: true, data: { ready: true, moved: returned, resource: id } };
        }
    };
    if (prepareBase !== null) {
        storageFlow.prepareBase = async (id, requiredAmount, options) => {
            prepareCalls.push({ id, requiredAmount, options });
            return { success: true, data: { ready: true, ...prepareBase(id, requiredAmount, options) } };
        };
    }
    const b2Input = {
        source,
        async acquire(id, requiredAmount, options) {
            acquired = { id, requiredAmount, options };
            inventoryCount = requiredAmount;
            return { success: true, data: { source: 'inventory', actualDelta: requiredAmount } };
        }
    };
    const coordinator = new B5B1InventoryCoordinator({
        storageFlow,
        b2Input,
        inventoryState,
        recipeRegistry: { require: () => ({ inputs: { coal: 16 } }) },
        config: { inventorySafetyEmptySlots: 2, b2InputSource: configuredSource },
        async runStep(_context, _step, action) { return action(); },
        childOptions(_context, extra = {}) { return extra; },
        async ensureFreeIntermediateSlots() { slots += 4; return { snapshot: { emptySlotCount: slots } }; }
    });
    const chain = { baseId: 'coal', b2Id: 'refined_coal', b2RecipeId: 'refined_coal', b3InputPerCraft: 4 };
    const context = { trace: { id: 'test' } };
    return {
        coordinator,
        chain,
        context,
        acquired: () => acquired,
        returned: () => returned,
        prepareCalls: () => prepareCalls,
        finalizeCalls: () => finalizeCalls,
        setCount: value => { inventoryCount = value; }
    };
}

test('V5 rejects storage-backed B2 acquisition contract', async () => {
    const { coordinator, chain, context } = createHarness({ source: 'storage' });
    await assert.rejects(
        coordinator.acquire(chain, context, { b2Remaining: 2 }),
        error => error?.code === 'B5_B1_INVENTORY_TRANSFER_UNAVAILABLE'
    );
});

test('V5 acquires only the useful B1 amount while reserving output slots', async () => {
    const { coordinator, chain, context, acquired } = createHarness({ count: 0, emptySlots: 6 });
    const result = await coordinator.acquire(chain, context, { b2Remaining: 3, minFreeForB3All: 1 });
    assert.equal(result.ready, true);
    assert.equal(result.basePerB2, 16);
    assert.equal(result.available, 48);
    assert.equal(result.craftable, 3);
    assert.equal(acquired().requiredAmount, 48);
    assert.equal(acquired().options.minimumFreeSlots, 2);
});

test('storage B2 acquisition refreshes the current B1 type and uses actual prepared stock, not planned stock', async () => {
    const { coordinator, chain, context, prepareCalls, acquired } = createHarness({
        source: 'storage',
        configuredSource: 'storage',
        prepareBase: () => ({ available: 32 })
    });
    const result = await coordinator.acquire(chain, context, { b2Remaining: 20, minFreeForB3All: 1 });
    assert.equal(result.ready, true);
    assert.equal(result.source, 'storage');
    assert.equal(result.available, 32);
    assert.equal(result.craftable, 2);
    assert.equal(prepareCalls().length, 1);
    assert.equal(prepareCalls()[0].id, 'coal');
    assert.equal(prepareCalls()[0].requiredAmount, 16);
    assert.equal(acquired(), null);
});

test('storage B3 boundary compacts only the currently active B1 type', async () => {
    const { coordinator, chain, context, finalizeCalls } = createHarness({ source: 'storage', configuredSource: 'storage' });
    const result = await coordinator.compactAfterB3(chain, context);
    assert.equal(result.baseId, 'coal');
    assert.equal(result.skipped, false);
    assert.equal(finalizeCalls().length, 1);
    assert.equal(finalizeCalls()[0].id, 'coal');
});

test('V5 returns all stale B1 through verified storage flow', async () => {
    const { coordinator, chain, context, returned } = createHarness({ count: 32, emptySlots: 6 });
    const result = await coordinator.returnToStorage(chain, context);
    assert.equal(result.skipped, false);
    assert.equal(result.returned, 32);
    assert.equal(result.remaining, 0);
    assert.equal(returned(), 32);
});

test('V5 return is a no-op when no B1 remains in inventory', async () => {
    const { coordinator, chain, context, returned } = createHarness({ count: 0 });
    const result = await coordinator.returnToStorage(chain, context);
    assert.equal(result.skipped, true);
    assert.equal(returned(), 0);
});

test('legacy storage-backed acquisition remains compatible when V5 inventory mode is not configured', async () => {
    const { coordinator, chain, context, acquired } = createHarness({ source: 'storage', configuredSource: 'storage', prepareBase: null });
    const result = await coordinator.acquire(chain, context, { b2Remaining: 3 });
    assert.equal(result.ready, true);
    assert.equal(result.source, 'storage');
    assert.equal(result.available, 48);
    assert.equal(result.craftable, 3);
    assert.equal(acquired(), null);
    const returned = await coordinator.returnToStorage(chain, context);
    assert.equal(returned.skipped, true);
    assert.equal(returned.source, 'storage');
});

test('stale B1 is returned before a new bounded inventory acquisition', async () => {
    const { coordinator, chain, context, acquired, returned } = createHarness({ count: 32, emptySlots: 1 });
    const result = await coordinator.acquire(chain, context, { b2Remaining: 2, minFreeForB3All: 1 });
    assert.equal(returned(), 32);
    assert.equal(result.ready, true);
    assert.equal(result.available, 32);
    assert.equal(acquired().requiredAmount, 32);
});
