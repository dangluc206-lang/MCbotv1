'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const CraftingRecipeRegistry = require('../../../src/server-features/crafting/CraftingRecipeRegistry');
const MaterialCalculator = require('../../../src/planning/crafting/MaterialCalculator');
const CraftingPlanner = require('../../../src/planning/crafting/CraftingPlanner');
const CraftPlanningService = require('../../../src/server-features/crafting/CraftPlanningService');
const ServerFeatureFacade = require('../../../src/server-features/ServerFeatureFacade');
const KhoSnapshot = require('../../../src/server-features/storage/KhoSnapshot');
const PersonalVaultSnapshot = require('../../../src/server-features/personal-vault/PersonalVaultSnapshot');

function createPlanning({ b2InputSource = 'storage', inventoryB1 = 0 } = {}) {
    const recipes = {
        b2: { output: 'b2', outputAmount: 1, inputs: { b1: 16 } },
        b3: { output: 'b3', outputAmount: 1, inputs: { b2: 16 } },
        b5: { output: 'b5', outputAmount: 1, inputs: { b3: 2 } }
    };
    const recipeRegistry = new CraftingRecipeRegistry(recipes);
    const materialCalculator = new MaterialCalculator({ recipeRegistry });
    const planner = new CraftingPlanner({ recipeRegistry, materialCalculator });
    const tiers = { B1: ['b1'], B2: ['b2'], B3: ['b3'], B4: [], B5: ['b5'] };
    const readFlows = {
        storage: { read: async () => ({ success: true, data: new KhoSnapshot({ items: { b1: 256 } }) }) },
        personalVault: { read: async () => ({ success: true, data: new PersonalVaultSnapshot({ totals: {}, slotCount: 54, emptySlotCount: 10 }) }) },
        inventory: {
            readViews: () => [{
                source: 'bot-inventory',
                items: inventoryB1 > 0 ? [{ logicalId: 'b1', count: inventoryB1 }] : [],
                emptySlotCount: 36
            }]
        }
    };
    const inventoryCounter = { count: (_view, id) => (id === 'b1' ? inventoryB1 : 0) };
    return new CraftPlanningService({
        planner,
        materialCalculator,
        recipeRegistry,
        tiers,
        readFlows,
        inventoryCounter,
        config: { supplyMode: 'continuous', inputSource: b2InputSource, vaultBackpressure: { minEmptySlots: 3 } }
    });
}

test('slice1 parity: CraftPlanningService exposes generic reconfigure (no direct config replace)', () => {
    const planning = createPlanning();
    assert.equal(typeof planning.reconfigure, 'function', 'generic planning must expose reconfigure for cycle boundary');
});

test('slice1 parity: reconfigure maps legacy B5 keys to generic policy without behavior drift', async () => {
    const before = createPlanning({ b2InputSource: 'storage', inventoryB1: 64 });
    const after = createPlanning({ b2InputSource: 'storage', inventoryB1: 64 });
    after.reconfigure({ b1SupplyMode: 'continuous', b2InputSource: 'inventory', personalVaultBackpressure: { minEmptySlots: 3 } });
    assert.equal(after.config.inputSource, 'inventory');
    assert.equal(after.config.supplyMode, 'continuous');
    assert.deepEqual(after.config.vaultBackpressure, { minEmptySlots: 3 });
    const resBefore = await before.inspectAdditional('b5', 1);
    const resAfter = await after.inspectAdditional('b5', 1);
    assert.equal(resBefore.success, true);
    assert.equal(resAfter.success, true);
    // Same reads, only inputSource differs: inventory B1 is ignored under
    // storage source and counted once under inventory source (no double count).
    assert.equal(resBefore.data.chains[0].inventoryBase, 0);
    assert.equal(resAfter.data.chains[0].inventoryBase, 64);
    assert.equal(resAfter.data.chains[0].storedEffective, resBefore.data.chains[0].storedEffective + 64);
});

test('slice1 parity: generic planning reconfigures without a legacy view', async () => {
    const planning = createPlanning();
    planning.reconfigure({ inputSource: 'inventory' });
    const result = await planning.inspectAdditional('b5', 1);
    assert.equal(result.success, true);
    assert.ok(result.data.fullPlan, 'generic plan must stay available after reconfigure');
});

test('slice1 parity: reconfigure stores generic keys only (no B5 vocabulary)', () => {
    const planning = createPlanning();
    planning.reconfigure({ b1SupplyMode: 'finite', b2InputSource: 'inventory', personalVaultBackpressure: { minEmptySlots: 1 } });
    assert.equal('b1SupplyMode' in planning.config, false);
    assert.equal('b2InputSource' in planning.config, false);
    assert.equal('personalVaultBackpressure' in planning.config, false);
    assert.equal(planning.config.supplyMode, 'finite');
    assert.equal(planning.config.inputSource, 'inventory');
});

test('slice1 parity: ServerFeatureFacade exposes generic planning/automation', () => {
    const planning = { inspectAdditionalFresh: async () => ({}) };
    const automation = { runNext: async () => ({}) };
    const facade = new ServerFeatureFacade({ craftingPlanning: planning, craftingAutomation: automation });
    assert.equal(facade.craftingPlanning(), planning);
    assert.equal(facade.craftingAutomation(), automation);
});
