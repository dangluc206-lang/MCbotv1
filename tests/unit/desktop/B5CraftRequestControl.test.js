'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ItemRegistry = require('../../../src/items/ItemRegistry');
const CraftingRecipeRegistry = require('../../../src/server-features/crafting/CraftingRecipeRegistry');
const CraftingItemRegistry = require('../../../src/items/CraftingItemRegistry');
const CraftingRequest = require('../../../src/items/CraftingRequest');
const B5CraftRequestUseCases = require('../../../src/desktop/use-cases/B5CraftRequestUseCases');
const DesktopApiContract = require('../../../src/desktop/contracts/DesktopApiContract');

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

// The stub mode mirrors B5CraftModeService.setCraftRequest validation through the
// real CraftingRequest so the control plane is exercised against real contracts.
function harness({ withMode = true, withRegistry = true } = {}) {
    const registry = createRegistry();
    const calls = { set: [], clear: [] };
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
    const useCases = new B5CraftRequestUseCases({
        bundleProvider: () => ({
            application: {
                getRuntime: () => ({
                    getService: name => (name === 'b5CraftMode' ? (withMode ? mode : null) : (withRegistry ? registry : null))
                })
            }
        }),
        requireRunning: () => {}
    });
    return { useCases, calls };
}

test('item list comes from CraftingItemRegistry with real in-game display names', () => {
    const { useCases } = harness();
    const { items } = useCases.items('bot-01');
    assert.ok(items.length > 0);
    const byId = new Map(items.map(entry => [entry.id, entry.displayName]));
    assert.equal(byId.get('titanium'), 'Titanium');
    assert.equal(byId.get('carbon'), 'Carbon');
    assert.equal(byId.get('super_alloy'), 'Siêu hợp kim');
});

test('item list exposes only registry items that are actually craftable', () => {
    const { useCases } = harness();
    const registry = createRegistry();
    const { items } = useCases.items('bot-01');
    assert.equal(items.every(entry => Boolean(registry.getRecipe(entry.id))), true);
    assert.equal(items.some(entry => entry.id === 'cobblestone'), false, 'raw B1 material without a recipe must not be offered');
});

test('item list never presents a tier letter as the operator-facing label', () => {
    const { useCases } = harness();
    const { items } = useCases.items('bot-01');
    assert.equal(items.every(entry => !/^B[1-5]$/.test(String(entry.displayName).trim())), true);
});

test('selecting Titanium sends the exact internal targetItemId', async () => {
    const { useCases, calls } = harness();
    const result = await useCases.set('bot-01', { targetItemId: 'titanium', quantity: 10 });
    assert.equal(result.success, true);
    assert.equal(calls.set[0].targetItemId, 'titanium');
    assert.equal(calls.set[0].quantity, 10);
});

test('selecting Carbon sends the exact internal targetItemId', async () => {
    const { useCases, calls } = harness();
    const result = await useCases.set('bot-01', { targetItemId: 'carbon', quantity: 100 });
    assert.equal(result.success, true);
    assert.equal(calls.set[0].targetItemId, 'carbon');
});

test('selecting Siêu hợp kim sends super_alloy and never injects a fallback target', async () => {
    const { useCases, calls } = harness();
    assert.equal((await useCases.set('bot-01', { targetItemId: 'super_alloy', quantity: 10 })).success, true);
    assert.equal(calls.set[0].targetItemId, 'super_alloy');
    assert.equal((await useCases.set('bot-01', { targetItemId: 'titanium', quantity: 1 })).success, true);
    assert.equal(calls.set[1].targetItemId, 'titanium', 'super_alloy must not be injected for a titanium request');
});

test('ALL is forwarded as a quantity mode, not an unbounded number', async () => {
    const { useCases, calls } = harness();
    const result = await useCases.set('bot-01', { targetItemId: 'titanium', quantity: 'ALL' });
    assert.equal(result.success, true);
    assert.equal(calls.set[0].quantity, 'ALL');
    assert.equal(result.data.request.quantityMode, 'ALL');
    assert.equal(result.data.request.quantity, null);
});

test('invalid quantities are rejected and surfaced instead of silently accepted', async () => {
    for (const quantity of [0, -5, '', ' ', 1.5, NaN, 'abc']) {
        const { useCases, calls } = harness();
        const result = await useCases.set('bot-01', { targetItemId: 'titanium', quantity });
        assert.equal(result.success, false, `quantity ${JSON.stringify(quantity)} must be rejected`);
        assert.ok(result.error || result.message);
        assert.equal(calls.set.length, 1);
    }
});

test('an unknown target item is rejected by the control path', async () => {
    const { useCases } = harness();
    const result = await useCases.set('bot-01', { targetItemId: 'not_a_real_item', quantity: 1 });
    assert.equal(result.success, false);
});

test('a request that the mode rejects is surfaced as failure, not as success', async () => {
    const { useCases } = harness();
    const result = await useCases.set('bot-01', { targetItemId: 'super_cobblestone', quantity: 0 });
    assert.equal(result.success, false);
    assert.equal(result.status, 'NOT_READY');
});

test('clear forwards to clearCraftRequest and returns the final request snapshot', () => {
    const { useCases, calls } = harness();
    const result = useCases.clear('bot-01');
    assert.equal(result.success, true);
    assert.deepEqual(calls.clear, ['desktop-operator']);
    assert.equal(result.data.snapshot.completedUnits, 3);
});

test('control path fails closed when the mode or registry is unavailable', async () => {
    const withoutMode = harness({ withMode: false });
    const setResult = await withoutMode.useCases.set('bot-01', { targetItemId: 'titanium', quantity: 1 });
    assert.equal(setResult.success, false);
    assert.equal(withoutMode.calls.set.length, 0, 'no request may reach an unavailable mode');

    const withoutRegistry = harness({ withRegistry: false });
    assert.throws(() => withoutRegistry.useCases.items('bot-01'), /registry is unavailable/);
});

test('desktop IPC channels for craft requests stay declared with the right permission', () => {
    assert.equal(DesktopApiContract.CATALOG['mcbot:b5:craft-items:list']?.permission, 'READ');
    assert.equal(DesktopApiContract.CATALOG['mcbot:b5:craft-request:set']?.permission, 'PATCH');
    assert.equal(DesktopApiContract.CATALOG['mcbot:b5:craft-request:clear']?.permission, 'PATCH');
});