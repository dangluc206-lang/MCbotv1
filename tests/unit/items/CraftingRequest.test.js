'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ItemRegistry = require('../../../src/items/ItemRegistry');
const CraftingRecipeRegistry = require('../../../src/server-features/crafting/CraftingRecipeRegistry');
const CraftingItemRegistry = require('../../../src/items/CraftingItemRegistry');
const CraftingRequest = require('../../../src/items/CraftingRequest');

const ITEMS = require('../../../config/items/items.json');
const RECIPES = require('../../../config/server-data/recipes.json');
const TIERS = require('../../../config/server-data/crafting-tiers.json');

function createRegistry() {
    return new CraftingItemRegistry({
        itemRegistry: new ItemRegistry(ITEMS),
        recipeRegistry: new CraftingRecipeRegistry(RECIPES),
        tiers: TIERS
    });
}

test('creates a request from a real item id', () => {
    const request = CraftingRequest.create({ targetItemId: 'super_alloy', quantity: 3, itemRegistry: createRegistry() });
    assert.equal(request.targetItemId, 'super_alloy');
    assert.equal(request.quantityMode, 'FIXED');
    assert.equal(request.quantity, 3);
    assert.ok(request.targetDisplayName);
});

test('creates a request from an in-game display name and normalizes to item id', () => {
    const request = CraftingRequest.create({ targetItemId: 'Siêu đá cuội', quantity: 1, itemRegistry: createRegistry() });
    assert.equal(request.targetItemId, 'super_cobblestone');
});

test('ALL is a quantity mode, not a sentinel number', () => {
    const registry = createRegistry();
    for (const raw of ['ALL', 'all', '  All ']) {
        const request = CraftingRequest.create({ targetItemId: 'titanium', quantity: raw, itemRegistry: registry });
        assert.equal(request.quantityMode, 'ALL');
        assert.equal(request.quantity, null);
        assert.equal(CraftingRequest.isAll(request), true);
    }
    const fixed = CraftingRequest.create({ targetItemId: 'titanium', quantity: 5, itemRegistry: registry });
    assert.equal(CraftingRequest.isAll(fixed), false);
});

test('accepts positive integers including numeric strings', () => {
    const registry = createRegistry();
    for (const raw of [1, 64, 999999, '5', ' 12 ']) {
        const request = CraftingRequest.create({ targetItemId: 'tungsten', quantity: raw, itemRegistry: registry });
        assert.equal(request.quantity, Number(String(raw).trim()));
        assert.equal(request.quantityMode, 'FIXED');
    }
});

test('rejects invalid quantities', () => {
    const registry = createRegistry();
    for (const raw of [0, -1, NaN, Infinity, -Infinity, 1.5, true, false, null, undefined, '', '0', '-1', '1.5', 'abc', {}, []]) {
        assert.throws(
            () => CraftingRequest.create({ targetItemId: 'tungsten', quantity: raw, itemRegistry: registry }),
            error => error.code === CraftingRequest.ERROR_CODES.QUANTITY,
            `quantity ${String(raw)} must be rejected`
        );
    }
});

test('rejects unknown items and tier identifiers', () => {
    const registry = createRegistry();
    for (const target of ['does_not_exist', 'B5', 'B4', 'B1', '', '   ', null, undefined]) {
        assert.throws(
            () => CraftingRequest.create({ targetItemId: target, quantity: 1, itemRegistry: registry }),
            error => error.code === CraftingRequest.ERROR_CODES.ITEM,
            `target ${String(target)} must be rejected`
        );
    }
});

test('requires the item registry', () => {
    assert.throws(
        () => CraftingRequest.create({ targetItemId: 'titanium', quantity: 1 }),
        error => error.code === CraftingRequest.ERROR_CODES.REGISTRY
    );
    assert.throws(
        () => CraftingRequest.create({ targetItemId: 'titanium', quantity: 1, itemRegistry: {} }),
        error => error.code === CraftingRequest.ERROR_CODES.REGISTRY
    );
});

test('created requests are immutable', () => {
    const request = CraftingRequest.create({ targetItemId: 'super_alloy', quantity: 2, itemRegistry: createRegistry() });
    assert.throws(() => { request.quantity = 99; }, TypeError);
});
