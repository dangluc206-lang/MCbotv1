'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ServerProfile = require('../../../src/server-profiles/ServerProfile');
const CraftingRecipeRegistry = require('../../../src/server-features/crafting/CraftingRecipeRegistry');
const CraftingQuantityResolver = require('../../../src/server-features/crafting/CraftingQuantityResolver');
const KhoCapacityReader = require('../../../src/server-features/storage/KhoCapacityReader');
const KhoReader = require('../../../src/server-features/storage/KhoReader');

function stubItemResolver() {
    return {
        resolve(item) { return item.logicalId ? { id: item.logicalId } : null; },
        matches(item, logicalId) { return { matched: item.logicalId === logicalId }; }
    };
}

test('WP-104 fake profile changes recipe, quantity, storage capacity and server timing without core edits', () => {
    const storage = {
        resourceAmountPatterns: ['amount\\s*:?\\s*(?<value>[\\d.,]+)'],
        capacityIndicator: { itemId: 'storage_capacity', scanAllSlots: true, fallbackLimit: 123456 }
    };
    const profile = new ServerProfile({
        id: 'fake', revision: 'r-fake-storage', endpoint: { host: 'fake.test' },
        catalogs: {
            recipes: { refined_x: { inputs: { raw_x: 8 }, output: { itemId: 'refined_x', amount: 2 }, menuItemId: 'x', menuSlot: 7 } },
            craftingTiers: { B1: ['raw_x'], B2: ['refined_x'] },
            storage,
            personalVault: { storageSlots: [0, 1] },
            minerals: { crafting: { quantitySlots: { '1': 2, '64': 4, ALL: 6 } } },
            mineralConversions: {}, smelting: { recipes: {} },
            serverTimings: { postB5CooldownMs: 42000 }
        }, capabilities: { recipes: true, crafting: true, storage: true, personalVault: true, smelting: true, conversion: true }
    });
    assert.equal(new CraftingRecipeRegistry(profile.requireCatalog('recipes')).require('refined_x').inputs.raw_x, 8);
    const quantity = new CraftingQuantityResolver(profile.requireCatalog('minerals').crafting);
    const slots = Array(8).fill(null); slots[4] = { name: 'paper', count: 64, displayName: '64' };
    assert.equal(quantity.resolve(64, { slots, inventoryStart: 8 }), 4);
    const resolver = stubItemResolver();
    const capacityReader = new KhoCapacityReader({ itemResolver: resolver, config: storage });
    const reader = new KhoReader({ itemResolver: resolver, capacityReader, config: storage });
    const window = { slots: [{ logicalId: 'raw_x', name: 'stone', lore: ['Amount: 1000'] }] };
    assert.equal(reader.read(window).capacity.limit, 123456);
    assert.equal(profile.requireCatalog('serverTimings').postB5CooldownMs, 42000);
});

test('WP-104 unknown required server timing fails closed and B5 policy remains outside profile catalogs', () => {
    const profile = new ServerProfile({ id: 'incomplete', revision: 'r-1', endpoint: { host: 'incomplete.test' }, catalogs: { recipes: {} } });
    assert.throws(() => profile.requireCatalog('serverTimings'), error => error.code === 'SERVER_PROFILE_NOT_READY');
    assert.equal(profile.getCatalog('b5Policy'), null);
});
