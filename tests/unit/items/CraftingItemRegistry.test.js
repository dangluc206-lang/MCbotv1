'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ItemRegistry = require('../../../src/items/ItemRegistry');
const CraftingRecipeRegistry = require('../../../src/server-features/crafting/CraftingRecipeRegistry');
const CraftingItemRegistry = require('../../../src/items/CraftingItemRegistry');

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

test('resolves items by real item id', () => {
    const registry = createRegistry();
    const entry = registry.resolveById('super_alloy');
    assert.ok(entry);
    assert.equal(entry.id, 'super_alloy');
    assert.equal(entry.tier, 'B5');
    assert.ok(entry.displayName);
    const b2 = registry.resolveById('super_cobblestone');
    assert.equal(b2.tier, 'B2');
    assert.deepEqual(b2.identities, ['MMOITEMS_ITEM_ID:SIEUDACUOI']);
    assert.equal(registry.resolveById('does_not_exist'), null);
});

test('resolves items by in-game display name, case-insensitive', () => {
    const registry = createRegistry();
    const entry = registry.resolveByDisplayName('Siêu đá cuội');
    assert.ok(entry);
    assert.equal(entry.id, 'super_cobblestone');
    const lowered = registry.resolveByDisplayName('  siêu đá cuội ');
    assert.equal(lowered.id, 'super_cobblestone');
    assert.equal(registry.resolveByDisplayName('Không có item này'), null);
    assert.equal(registry.resolveByDisplayName(''), null);
});

test('exposes the configured recipe for every craftable item', () => {
    const registry = createRegistry();
    const recipe = registry.getRecipe('titanium');
    assert.deepEqual(recipe, RECIPES.titanium);
    assert.equal(registry.getRecipe('cobblestone'), null);
    // recipe must match the source registry content
    for (const recipeId of Object.keys(RECIPES)) {
        assert.deepEqual(registry.getRecipe(RECIPES[recipeId].output), RECIPES[recipeId]);
    }
});

test('computes input and output chains across the recipe graph', () => {
    const registry = createRegistry();
    const inputChain = registry.getInputChain('super_alloy');
    assert.ok(inputChain.includes('tungsten'));
    assert.ok(inputChain.includes('refined_diamond_block'));
    assert.ok(inputChain.includes('super_cobblestone'));
    assert.ok(!inputChain.includes('super_alloy'));
    // B1 raw materials terminate the chain (no recipe)
    assert.deepEqual(registry.getInputChain('diamond'), []);

    const outputChain = registry.getOutputChain('refined_iron');
    assert.ok(outputChain.includes('refined_iron_block'));
    assert.ok(outputChain.includes('titanium'));
    assert.ok(outputChain.includes('super_alloy'));
    assert.deepEqual(registry.getOutputChain('super_alloy'), []);
});

test('every configured tier item resolves with correct classification and recipe data', () => {
    const registry = createRegistry();
    const tierCounts = { B1: 0, B2: 0, B3: 0, B4: 0, B5: 0 };
    for (const [tier, ids] of Object.entries(TIERS)) {
        for (const id of ids) {
            const entry = registry.resolveById(id);
            assert.ok(entry, `${id} (${tier}) must resolve`);
            assert.equal(entry.tier, tier, `${id} must be classified as ${tier}`);
            assert.equal(entry.id, id);
            assert.ok(entry.displayName, `${id} must expose a display name`);
            if (tier === 'B1') {
                assert.equal(entry.recipe, null, `${id} is a raw material`);
            } else {
                assert.ok(entry.recipe, `${id} must have a recipe`);
                assert.equal(entry.recipe.output, id);
            }
            tierCounts[tier] += 1;
        }
    }
    assert.deepEqual(tierCounts, { B1: 8, B2: 8, B3: 8, B4: 3, B5: 1 });
    const all = registry.items();
    assert.equal(all.length, 28);
    // identity data survives: MMOItems identity must not be lost
    const sieuDaCuoi = all.find(item => item.id === 'super_cobblestone');
    assert.ok(sieuDaCuoi.identities.includes('MMOITEMS_ITEM_ID:SIEUDACUOI'));
});

test('registry validates its dependencies', () => {
    assert.throws(() => new CraftingItemRegistry({}), TypeError);
    assert.throws(() => new CraftingItemRegistry({ itemRegistry: new ItemRegistry(ITEMS) }), TypeError);
    assert.throws(() => createRegistry().requireById('does_not_exist'), /not found/i);
});
