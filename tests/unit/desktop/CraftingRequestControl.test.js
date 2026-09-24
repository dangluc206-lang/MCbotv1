'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ItemRegistry = require('../../../src/items/ItemRegistry');
const CraftingRecipeRegistry = require('../../../src/server-features/crafting/CraftingRecipeRegistry');
const CraftingItemRegistry = require('../../../src/items/CraftingItemRegistry');
const CraftingTargetRegistry = require('../../../src/items/CraftingTargetRegistry');
const CraftingRequest = require('../../../src/items/CraftingRequest');
const CraftingRequestUseCases = require('../../../src/desktop/use-cases/CraftingRequestUseCases');
const B5CraftRequestUseCases = require('../../../src/desktop/use-cases/B5CraftRequestUseCases');
const DesktopApiContract = require('../../../src/desktop/contracts/DesktopApiContract');

const ITEMS = require('../../../config/items/items.json');
const RECIPES = require('../../../config/server-data/recipes.json');
const TIERS = require('../../../config/server-data/crafting-tiers.json');
const TARGET_POLICY = require('../../../config/server-data/crafting-targets.json');

function createRegistry() {
    return new CraftingItemRegistry({
        itemRegistry: new ItemRegistry(ITEMS),
        recipeRegistry: new CraftingRecipeRegistry(RECIPES),
        tiers: TIERS
    });
}

function harness({ withMode = true, withRegistry = true } = {}) {
    const registry = createRegistry();
    const targetRegistry = new CraftingTargetRegistry({ craftingItemRegistry: registry, policy: TARGET_POLICY });
    const calls = { set: [], clear: [] };
    const seenServices = [];
    const mode = {
        setCraftRequest(request) {
            calls.set.push(request);
            try {
                const created = CraftingRequest.create({ targetItemId: request?.targetItemId, quantity: request?.quantity, itemRegistry: registry });
                return { success: true, status: 'OK', data: { request: created, appliedAt: 'next-cycle' } };
            } catch (error) {
                return { success: false, status: 'NOT_READY', message: error.message, error: { code: error.code || null } };
            }
        },
        clearCraftRequest(reason) {
            calls.clear.push(reason);
            return { state: 'COMPLETED', completedUnits: 3, targetItemId: 'titanium' };
        }
    };
    const useCases = new CraftingRequestUseCases({
        bundleProvider: () => ({
            application: {
                getRuntime: () => ({
                    getService: name => {
                        seenServices.push(name);
                        if (name === 'craftingMode') return withMode ? mode : null;
                        if (name === 'craftingTargetRegistry') return withRegistry ? targetRegistry : null;
                        if (name === 'craftingItemRegistry') return withRegistry ? registry : null;
                        return null;
                    }
                })
            }
        }),
        requireRunning: () => {}
    });
    return { useCases, calls, seenServices, registry, targetRegistry };
}

test('generic target list comes from CraftingTargetRegistry with real display names', () => {
    const { useCases, targetRegistry } = harness();
    const { items } = useCases.items('bot-01');
    assert.ok(items.length > 0);
    assert.ok(items.every(entry => targetRegistry.isTarget(entry.id)));
    const byId = new Map(items.map(entry => [entry.id, entry.displayName]));
    assert.equal(byId.get('titanium'), 'Titanium');
});

test('generic set forwards targetItemId untouched to craftingMode', async () => {
    const { useCases, calls } = harness();
    const result = await useCases.set('bot-01', { targetItemId: 'carbon', quantity: 100 });
    assert.equal(result.success, true);
    assert.equal(calls.set[0].targetItemId, 'carbon');
});

test('generic control path never touches b5CraftMode', async () => {
    const { useCases, seenServices } = harness();
    useCases.items('bot-01');
    await useCases.set('bot-01', { targetItemId: 'titanium', quantity: 1 });
    useCases.clear('bot-01');
    assert.ok(seenServices.includes('craftingMode'));
    assert.ok(seenServices.includes('craftingTargetRegistry'));
    assert.equal(seenServices.some(name => String(name).toLowerCase().includes('b5')), false);
});

test('generic IPC channels are declared with the same permission contract', () => {
    assert.equal(DesktopApiContract.CATALOG['mcbot:crafting:items:list']?.permission, 'READ');
    assert.equal(DesktopApiContract.CATALOG['mcbot:crafting:request:set']?.permission, 'PATCH');
    assert.equal(DesktopApiContract.CATALOG['mcbot:crafting:request:clear']?.permission, 'PATCH');
    // Compat channels stay with identical permissions while the renderer migrates.
    assert.equal(DesktopApiContract.CATALOG['mcbot:b5:craft-items:list']?.permission, 'READ');
    assert.equal(DesktopApiContract.CATALOG['mcbot:b5:craft-request:set']?.permission, 'PATCH');
    assert.equal(DesktopApiContract.CATALOG['mcbot:b5:craft-request:clear']?.permission, 'PATCH');
});

test('B5 use-case stays a compat alias of the generic use-case', () => {
    assert.ok(new B5CraftRequestUseCases({ bundleProvider: () => ({}), requireRunning: () => {} }) instanceof CraftingRequestUseCases);
});
