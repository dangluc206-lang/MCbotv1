'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CraftPlanningService = require('../../../src/server-features/crafting/CraftPlanningService');
const B5PlanningService = require('../../../src/server-features/crafting/B5PlanningService');
const CraftAutomationService = require('../../../src/server-features/crafting/CraftAutomationService');
const B5AutomationService = require('../../../src/server-features/crafting/B5AutomationService');
const CraftTraceRecorder = require('../../../src/server-features/crafting/CraftTraceRecorder');
const B5TraceRecorder = require('../../../src/server-features/crafting/b5/trace/B5TraceRecorder');
const ServerFeatureFacade = require('../../../src/server-features/ServerFeatureFacade');
const CraftingRecipeRegistry = require('../../../src/server-features/crafting/CraftingRecipeRegistry');
const MaterialCalculator = require('../../../src/planning/crafting/MaterialCalculator');
const CraftingPlanner = require('../../../src/planning/crafting/CraftingPlanner');
function createPlanning(inputSource = 'storage', inventoryB1 = 0) {
    const recipes = { b2: { output: 'b2', outputAmount: 1, inputs: { b1: 16 } }, b3: { output: 'b3', outputAmount: 1, inputs: { b2: 16 } }, b5: { output: 'b5', outputAmount: 1, inputs: { b3: 2 } } };
    const recipeRegistry = new CraftingRecipeRegistry(recipes);
    const materialCalculator = new MaterialCalculator({ recipeRegistry });
    const planner = new CraftingPlanner({ recipeRegistry, materialCalculator });
    const tiers = { B1: ['b1'], B2: ['b2'], B3: ['b3'], B4: [], B5: ['b5'] };
    const readFlows = { storage: { read: async () => ({ success: true, data: { items: { b1: 256 } } }) }, personalVault: { read: async () => ({ success: true, data: { totals: {} } }) }, inventory: { readViews: () => [] } };
    return new CraftPlanningService({ planner, materialCalculator, recipeRegistry, tiers, readFlows, inventoryCounter: { count: () => 0 }, config: { supplyMode: 'continuous', inputSource, vaultBackpressure: {} } });
}

test('slice6: CraftTraceRecorder keeps legacy id + generic fields', () => {
    const recorder = new CraftTraceRecorder({ botId: 'bot-01', historyLimit: 10 });
    assert.ok(recorder instanceof B5TraceRecorder);
    const record = recorder.recordResult({
        success: true, status: 'SUCCESS',
        data: { targetId: 'carbon', productive: true, completedTarget: false, blockingReasons: [], actionSummary: {}, plan: null },
        meta: { operationId: 'bot-01:1', connectionGeneration: 3, trace: [] }
    }, { targetId: 'carbon' });
    assert.equal(record.traceId, 'bot-01:b5:1');
    assert.equal(record.targetId, 'carbon');
    assert.ok(String(record.craftTraceId).includes(':craft:'));
});
test('slice4: CraftAutomationService same engine + fail-closed', async () => {
    assert.equal(Object.getPrototypeOf(CraftAutomationService), B5AutomationService);
    const automation = new CraftAutomationService({
        planningService: { async inspectAdditional() { throw new Error('x'); }, async inspectAdditionalFresh() { throw new Error('x'); } },
        crafting: { async craft() { throw new Error('x'); } },
        personalVault: { async read() { throw new Error('x'); }, async withdraw() { throw new Error('x'); }, async deposit() { throw new Error('x'); } },
        storage: {}, b1Materials: {},
        inventoryReader: { read: () => ({}) }, inventoryCounter: { count: () => 0 },
        recipeRegistry: { require: id => ({ output: id, inputs: {} }) },
        operationManager: { async run() { throw new Error('x'); } }, config: {},
        craftingVerificationService: { requireInputReady() {}, handoff: () => ({ ready: true }), verifyOutput() {}, requireSettled() {} },
        flows: { read: {}, plan: {}, storage: {}, b2Input: {}, deposit: {}, withdraw: {}, craft: {} }
    });
    const result = await automation.runTarget({});
    assert.equal(result.success, false);
    assert.equal(result.status, 'INVALID_INPUT');
});
test('slice6: facade craftingTrace/b5Trace same instance', () => {
    const recorder = new CraftTraceRecorder({ botId: 'bot-01' });
    const facade = new ServerFeatureFacade({ craftingTrace: recorder });
    assert.equal(facade.craftingTrace(), recorder);
    assert.equal(facade.b5Trace(), recorder);
});
test('slice4: automation reconfigure maps legacy input source', () => {
    const normalized = B5AutomationService.normalizeAutomationConfig({ b2InputSource: 'inventory', inputSource: 'storage' }, { inputSource: 'storage' });
    assert.equal(normalized.inputSource, 'storage');
    assert.equal('b2InputSource' in normalized, false);
    assert.equal(B5AutomationService.normalizeAutomationConfig({ b2InputSource: 'inventory' }, {}).inputSource, 'inventory');
});
test('slice3: legacy B5 view plans request targetId', async () => {
    const planning = createPlanning('inventory', 64);
    const b5 = new B5PlanningService({ planning, tiers: { B1: ['b1'], B2: ['b2'], B3: ['b3'], B4: [], B5: ['b5'] }, targetId: 'b5' });
    const legacy = await b5.inspectAdditional(1, { targetId: 'carbon' });
    const generic = await planning.inspectAdditional('carbon', 1);
    assert.equal(legacy.data.fullPlan.targetId, 'carbon');
    assert.deepEqual(legacy.data.fullPlan, generic.data.fullPlan);
});
