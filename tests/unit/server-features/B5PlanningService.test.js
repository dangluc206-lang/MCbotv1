'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CraftingRecipeRegistry = require('../../../src/server-features/crafting/CraftingRecipeRegistry');
const MaterialCalculator = require('../../../src/planning/crafting/MaterialCalculator');
const CraftingPlanner = require('../../../src/planning/crafting/CraftingPlanner');
const B5Planner = require('../../../src/planning/crafting/B5Planner');
const B5PlanningService = require('../../../src/server-features/crafting/B5PlanningService');
const KhoSnapshot = require('../../../src/server-features/storage/KhoSnapshot');
const PersonalVaultSnapshot = require('../../../src/server-features/personal-vault/PersonalVaultSnapshot');

function createService({ loose = 0, blocks = 0, existingB5 = 0, pvEmptySlots = null, blockCraftable = true } = {}) {
    const recipes = {
        b2: { output: 'b2', outputAmount: 1, inputs: { b1: 16 } },
        b3: { output: 'b3', outputAmount: 1, inputs: { b2: 16 } },
        b5: { output: 'b5', outputAmount: 1, inputs: { b3: 2 } }
    };
    const recipeRegistry = new CraftingRecipeRegistry(recipes);
    const materialCalculator = new MaterialCalculator({ recipeRegistry });
    const planner = new CraftingPlanner({ recipeRegistry, materialCalculator });
    const tiers = { B1: ['b1'], B2: ['b2'], B3: ['b3'], B4: [], B5: ['b5'] };
    const b5Planner = new B5Planner({ planner, targetId: 'b5', tiers });
    const b1Materials = {
        effectiveItems(items) {
            return { ...items, b1: Number(items.b1 || 0) + Number(items.b1_block || 0) * 9 };
        },
        craftableItems(snapshot) {
            const items = snapshot?.items || {};
            return { ...items, b1: Number(items.b1 || 0) + (blockCraftable ? Number(items.b1_block || 0) * 9 : 0) };
        }
    };
    return new B5PlanningService({
        storage: { read: async () => ({ success: true, data: new KhoSnapshot({ items: { b1: loose, b1_block: blocks } }) }) },
        personalVault: {
            read: async () => ({ success: true, data: new PersonalVaultSnapshot({ totals: { b3: 1, b5: existingB5 }, slotCount: pvEmptySlots === null ? null : 54, emptySlotCount: pvEmptySlots }) })
        },
        inventoryReader: { read: () => ({ items: [] }) },
        inventoryCounter: { count: () => 0 },
        b5Planner,
        materialCalculator,
        recipeRegistry,
        tiers,
        b1Materials,
        config: { b1SupplyMode: 'continuous', personalVaultBackpressure: { minEmptySlots: 3, hardMinEmptySlots: 1 } }
    });
}

test('planning counts compacted B1 blocks as effective material without selling B1 after B2', async () => {
    const result = await createService({ loose: 12, blocks: 32 }).inspectAdditional(1);
    assert.equal(result.success, true);
    const chain = result.data.chains[0];
    assert.equal(chain.rawNeededFromStorage, 256);
    assert.equal(chain.storedLoose, 12);
    assert.equal(chain.storedEffective, 300);
    assert.equal(chain.readyToReserve, true);
    assert.equal('sellAllAfterReserve' in chain, false);
    assert.equal(chain.b3Crafts, 1);
    assert.equal(chain.b2Crafts, 16);
});

test('planning waits when loose plus block-equivalent B1 is still insufficient', async () => {
    const result = await createService({ loose: 12, blocks: 20 }).inspectAdditional(1);
    assert.equal(result.success, true);
    const chain = result.data.chains[0];
    assert.equal(chain.storedEffective, 192);
    assert.equal(chain.missingRaw, 64);
    assert.equal(chain.readyToReserve, false);
});

test('inspectAdditional ignores existing B5 and always plans one new B5', async () => {
    const service = createService({ loose: 256, existingB5: 9 });
    const absolute = await service.inspect(1);
    const additional = await service.inspectAdditional(1);
    assert.equal(absolute.success, true);
    assert.equal(additional.success, true);
    assert.equal(absolute.data.fullPlan.steps.length, 0);
    assert.equal(additional.data.fullPlan.steps.some(step => step.outputId === 'b5'), true);
});


test('planning reports continuous B1 supply and PV2 backpressure without changing recipe math', async () => {
    const result = await createService({ loose: 256, pvEmptySlots: 2 }).inspectAdditional(1);
    assert.equal(result.success, true);
    assert.equal(result.data.b1Supply.mode, 'continuous');
    assert.equal(result.data.personalVaultPressure.known, true);
    assert.equal(result.data.personalVaultPressure.emptySlotCount, 2);
    assert.equal(result.data.personalVaultPressure.backpressure, true);
    assert.equal(result.data.personalVaultPressure.critical, false);
    assert.equal(result.data.personalVaultPressure.allowNewIntermediates, false);
});


test('planning does not treat unsafe compressed block stock as immediately craftable B1', async () => {
    const result = await createService({ loose: 12, blocks: 32, blockCraftable: false }).inspectAdditional(1);
    assert.equal(result.success, true);
    const chain = result.data.chains[0];
    assert.equal(chain.storedEffective, 12);
    assert.equal(chain.storedTotalEffective, 300);
    assert.equal(chain.decompressionBlocked, true);
    assert.equal(chain.readyToReserve, true, 'owned compressed stock is reservable after a PREPARE_B1/headroom step');
    assert.equal(result.data.progress.feasible, false);
    assert.equal(result.data.progress.nextStep?.kind, 'PREPARE_B1');
    assert.equal(result.data.progress.nextStep?.reason, 'decompression-headroom');
});

test('B5PlanningService preserves stable thrown dependency status instead of collapsing to FAILED', async () => {
    const service = createService({ loose: 256 });
    const error = new (require('../../../src/shared/errors/FlowError'))('Storage generation is stale.', {
        code: 'DISCONNECTED', subsystem: 'storage', operation: 'KhoService', step: 'generation-guard'
    });
    service.readFlows.kho.read = async () => { throw error; };

    const result = await service.inspectAdditional(1, { expectedGeneration: 7 });
    assert.equal(result.success, false);
    assert.equal(result.status, 'DISCONNECTED');
    assert.equal(result.error?.code, 'DISCONNECTED');
});
