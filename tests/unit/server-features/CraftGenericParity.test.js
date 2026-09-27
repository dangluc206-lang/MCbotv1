'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CraftingRecipeRegistry = require('../../../src/server-features/crafting/CraftingRecipeRegistry');
const MaterialCalculator = require('../../../src/planning/crafting/MaterialCalculator');
const CraftingPlanner = require('../../../src/planning/crafting/CraftingPlanner');
const CraftPlanningService = require('../../../src/server-features/crafting/CraftPlanningService');
const CraftReadService = require('../../../src/server-features/crafting/CraftReadService');
const B5PlanningService = require('../../../src/server-features/crafting/B5PlanningService');
const CraftAutomationService = require('../../../src/server-features/crafting/CraftAutomationService');
const B5AutomationService = require('../../../src/server-features/crafting/B5AutomationService');
const CraftTraceRecorder = require('../../../src/server-features/crafting/CraftTraceRecorder');
const B5TraceRecorder = require('../../../src/server-features/crafting/b5/trace/B5TraceRecorder');
const B1StorageMaterialService = require('../../../src/server-features/storage/B1StorageMaterialService');
const ServerFeatureFacade = require('../../../src/server-features/ServerFeatureFacade');
const KhoSnapshot = require('../../../src/server-features/storage/KhoSnapshot');
const PersonalVaultSnapshot = require('../../../src/server-features/personal-vault/PersonalVaultSnapshot');
function createPlanning(inputSource = 'storage', inventoryB1 = 0) {
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
        inventory: { readViews: () => [{ source: 'bot-inventory', items: [], emptySlotCount: 36 }] }
    };
    const inventoryCounter = { count: (_v, id) => (id === 'b1' ? inventoryB1 : 0) };
    return new CraftPlanningService({ planner, materialCalculator, recipeRegistry, tiers, readFlows, inventoryCounter, config: { supplyMode: 'continuous', inputSource, vaultBackpressure: { minEmptySlots: 3 } } });
}
test('slice2: CraftReadService same reads as planning', async () => {
    const planning = createPlanning();
    const read = new CraftReadService({ planning });
    assert.equal(read.dataMaxAgeMs, planning.dataMaxAgeMs);
    const kho = await read.readKho();
    assert.equal(kho.success, true);
    assert.equal(Number(kho.data.items.b1), 256);
    const before = await planning.inspectAdditional('b5', 1);
    const after = await read.inspectAdditional('b5', 1);
    assert.deepEqual(after.data.fullPlan, before.data.fullPlan);
});
test('slice2: CraftReadService fails closed', () => {
    assert.throws(() => new CraftReadService({}), /planning/);
});
test('slice3: protectForBatch alias shares boundary', async () => {
    const service = Object.create(B1StorageMaterialService.prototype);
    let calls = 0;
    service.batchProtection = { protect: async () => { calls += 1; return { success: true, data: { ok: true } }; } };
    const a = await service.protectForBatch({});
    const b = await service.protectForB5Batch({});
    assert.equal(a.success, true);
    assert.deepEqual(a, b);
    assert.equal(calls, 2);
});
