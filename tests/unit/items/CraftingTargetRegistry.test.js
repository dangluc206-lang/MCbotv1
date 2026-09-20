'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ItemRegistry = require('../../../src/items/ItemRegistry');
const CraftingRecipeRegistry = require('../../../src/server-features/crafting/CraftingRecipeRegistry');
const CraftingItemRegistry = require('../../../src/items/CraftingItemRegistry');
const CraftingTargetRegistry = require('../../../src/items/CraftingTargetRegistry');

const ITEMS = require('../../../config/items/items.json');
const RECIPES = require('../../../config/server-data/recipes.json');
const TIERS = require('../../../config/server-data/crafting-tiers.json');
const TARGET_POLICY = require('../../../config/server-data/crafting-targets.json');

function createItemRegistry({ items = ITEMS, recipes = RECIPES, tiers = TIERS } = {}) {
    return new CraftingItemRegistry({
        itemRegistry: new ItemRegistry(items),
        recipeRegistry: new CraftingRecipeRegistry(recipes),
        tiers
    });
}

function createRegistry(policy = TARGET_POLICY, itemRegistryOptions = {}) {
    return new CraftingTargetRegistry({
        craftingItemRegistry: createItemRegistry(itemRegistryOptions),
        policy
    });
}

test('targets come from configuration data, not hard-coded ids', () => {
    const registry = createRegistry();
    const ids = registry.ids();
    assert.ok(ids.length > 0);
    for (const tier of ['B3', 'B4', 'B5']) {
        for (const itemId of TIERS[tier]) {
            assert.equal(ids.includes(itemId), true, `${itemId} (tier ${tier}) must be a target by default`);
        }
    }
});

test('B2 intermediates are not operator targets unless the config allows them', () => {
    const registry = createRegistry();
    for (const itemId of TIERS.B2) {
        assert.equal(registry.isTarget(itemId), false, `${itemId} must not be a target by default`);
    }
    const relaxed = createRegistry({ ...TARGET_POLICY, allowedTiers: [...TARGET_POLICY.allowedTiers, 'B2'] });
    for (const itemId of TIERS.B2) {
        assert.equal(relaxed.isTarget(itemId), true, `config change alone must promote ${itemId}`);
    }
});

test('target entries carry the required identity and recipe contract', () => {
    const registry = createRegistry();
    const entry = registry.requireById('titanium');
    assert.equal(entry.id, 'titanium');
    assert.equal(entry.displayName, 'Titanium');
    assert.equal(entry.tier, 'B4');
    assert.equal(entry.outputAmount, 1);
    assert.deepEqual(entry.recipe, RECIPES.titanium);
    assert.deepEqual(entry.classifications, ['B4']);
    assert.ok(Array.isArray(entry.identities));
    for (const target of registry.targets()) {
        assert.equal(typeof target.id, 'string');
        assert.ok(target.displayName);
        assert.ok(target.recipe, `${target.id} must have a producing recipe`);
        assert.ok(Number.isInteger(target.outputAmount) && target.outputAmount > 0);
        assert.equal(typeof target.tier, 'string');
        assert.ok(Array.isArray(target.identities));
    }
});

test('every current craft product resolves as a generic target', () => {
    const registry = createRegistry();
    for (const id of ['titanium', 'carbon', 'tungsten', 'super_alloy', 'refined_iron_block']) {
        const entry = registry.requireById(id);
        assert.equal(entry.id, id);
        assert.ok(entry.recipe, `${id} resolves with a producing recipe`);
        assert.ok(TIERS[entry.tier].includes(id), `${id} is a config tier member`);
    }
});

test('display names are the real in-game names', () => {
    const registry = createRegistry();
    assert.equal(registry.requireById('super_alloy').displayName, 'Siêu hợp kim');
    assert.equal(registry.requireById('refined_iron_block').displayName, 'Khối sắt tinh luyện');
    assert.equal(registry.requireById('carbon').displayName, 'Carbon');
});

test('registry never contains invalid targets', () => {
    const registry = createRegistry();
    for (const target of registry.targets()) {
        assert.equal(typeof RECIPES[target.id], 'object', `${target.id} must exist in recipes.json`);
        assert.ok(TIERS[target.tier]?.includes(target.id), `${target.id} must be a tier member`);
    }
    assert.equal(registry.resolveById('cobblestone'), null, 'non-craftable B1 material must never be a target');
    assert.equal(registry.resolveById('does_not_exist'), null);
    assert.throws(() => registry.requireById('does_not_exist'), /Crafting target not found/);
});

test('policy data alone can deny a target or force an extra one', () => {
    const denied = createRegistry({ ...TARGET_POLICY, denyItems: ['titanium'] });
    assert.equal(denied.isTarget('titanium'), false);
    const forced = createRegistry({
        ...TARGET_POLICY,
        allowedTiers: [],
        allowItems: ['super_cobblestone'],
        denyItems: [],
        overrides: {}
    });
    assert.equal(forced.ids().includes('super_cobblestone'), true, 'config can promote an intermediate');
    assert.equal(forced.ids().includes('titanium'), false, 'removing the tier removes tier targets');
});

test('overrides can disable a target or rename it for the operator', () => {
    const disabled = createRegistry({ ...TARGET_POLICY, overrides: { titanium: { enabled: false } } });
    assert.equal(disabled.isTarget('titanium'), false);
    const renamed = createRegistry({ ...TARGET_POLICY, overrides: { titanium: { displayName: 'Titanium X' } } });
    assert.equal(renamed.requireById('titanium').displayName, 'Titanium X');
});

test('a brand new item and recipe become a target with config+data only', () => {    const items = {
        ...ITEMS,
        mythril: {
            representations: {
                inventory: { rules: [{ type: 'name', value: 'Mythril Bar' }] },
                'personal-vault': { rules: [{ type: 'identity', value: 'MMOITEMS_ITEM_ID:MYTHRIL' }] }
            },
            metadata: { strongIdentityPolicy: 'learn' }
        }
    };
    const recipes = {
        ...RECIPES,
        mythril: { output: 'mythril', outputAmount: 2, menuItemId: 'mythril', inputs: { titanium: 4 }, menuSlot: 34 }
    };
    const tiers = { ...TIERS, B5: [...TIERS.B5, 'mythril'] };
    const registry = createRegistry(TARGET_POLICY, { items, recipes, tiers });
    const entry = registry.requireById('mythril');
    assert.equal(entry.displayName, 'Mythril Bar');
    assert.equal(entry.tier, 'B5');
    assert.equal(entry.outputAmount, 2);
    assert.equal(entry.recipe.output, 'mythril');
    assert.equal(registry.isTarget('titanium'), true, 'existing targets keep working');
});

test('invalid target policy fails closed', () => {
    assert.throws(() => createRegistry({ ...TARGET_POLICY, allowedTiers: ['B9'] }), /allowedTiers/);
    assert.throws(() => createRegistry({ ...TARGET_POLICY, unknownKey: 1 }), /not allowed/);
    assert.throws(() => createRegistry({ ...TARGET_POLICY, schemaVersion: 2 }), /schemaVersion/);
    assert.throws(() => createRegistry({ ...TARGET_POLICY, allowItems: ['titanium'], denyItems: ['titanium'] }), /overlap/);
    assert.throws(() => createRegistry({ ...TARGET_POLICY, overrides: { titanium: { enabled: 'yes' } } }), /enabled must be boolean/);
    assert.throws(() => new CraftingTargetRegistry({ policy: TARGET_POLICY }), /CraftingItemRegistry/);
    assert.throws(() => new CraftingTargetRegistry({ craftingItemRegistry: {}, policy: TARGET_POLICY }), /CraftingItemRegistry/);
});