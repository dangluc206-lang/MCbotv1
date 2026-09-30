'use strict';

// Slice 6 Step 1 - Diagnostics + chain-field adapter (no runtime cutover).
// B5ActionDiagnostics keeps legacy behavior; CraftActionDiagnostics must match
// it on every observable input while exposing role-based generic keys.

const test = require('node:test');
const assert = require('node:assert/strict');
const B5ActionDiagnostics = require('../../../src/server-features/crafting/b5/support/B5ActionDiagnostics');
const CraftActionDiagnostics = require('../../../src/server-features/crafting/support/CraftActionDiagnostics');
const { fromLegacyChain, isGenericChain } = require('../../../src/server-features/crafting/support/CraftChainAdapter');
const B5PlanningService = require('../../../src/server-features/crafting/B5PlanningService');
const CraftPlanningService = require('../../../src/server-features/crafting/CraftPlanningService');
const CraftingRecipeRegistry = require('../../../src/server-features/crafting/CraftingRecipeRegistry');
const MaterialCalculator = require('../../../src/planning/crafting/MaterialCalculator');
const CraftingPlanner = require('../../../src/planning/crafting/CraftingPlanner');
const KhoSnapshot = require('../../../src/server-features/storage/KhoSnapshot');
const PersonalVaultSnapshot = require('../../../src/server-features/personal-vault/PersonalVaultSnapshot');

test('step1: generic diagnostics preserve blocker/result semantics', () => {
    const actions = [
        { status: 'waiting', reason: 'headroom', baseId: 'coal' },
        { status: 'waiting', reason: 'headroom', baseId: 'coal' },
        { status: 'base-ready', baseId: 'iron_ingot' },
        { status: 'skipped-noop', baseId: 'gold_ingot' },
        { status: 'deferred-for-space', reason: 'capacity', targetId: 'carbon' },
        { status: 'new-b2-suppressed', reason: 'pv2-backpressure', baseId: 'diamond' }
    ];
    const legacy = B5ActionDiagnostics.blockingReasons(actions);
    const generic = CraftActionDiagnostics.blockingReasons(actions);
    assert.equal(generic.length, legacy.length);
    for (let index = 0; index < legacy.length; index += 1) {
        assert.equal(generic[index].status, legacy[index].status);
        assert.equal(generic[index].reason, legacy[index].reason);
        assert.equal(generic[index].baseId, legacy[index].baseId);
        assert.equal(generic[index].targetId, legacy[index].targetId);
        assert.deepEqual(generic[index], {
            status: legacy[index].status,
            reason: legacy[index].reason,
            baseId: legacy[index].baseId,
            targetId: legacy[index].targetId,
            outputId: legacy[index].b3Id,
            intermediateId: null,
            message: legacy[index].message
        });
    }
    for (const action of actions) {
        assert.equal(CraftActionDiagnostics.isProductiveAction(action), B5ActionDiagnostics.isProductiveAction(action));
    }
    assert.deepEqual(CraftActionDiagnostics.summarizeActions(actions), B5ActionDiagnostics.summarizeActions(actions));
});

test('step1: chain adapter maps full legacy shape without mutation or B5 keys', () => {
    const legacy = Object.freeze({
        baseId: 'coal', b2Id: 'refined_coal', b3Id: 'refined_coal_block',
        b2RecipeId: 'refined_coal', b3RecipeId: 'refined_coal_block',
        b2OutputAmount: 1, b3InputPerCraft: 16,
        rawPerB3: 256, rawNeededFromStorage: 128,
        storedLoose: 12, inventoryB1: 64, storageEffective: 192, storageTotalEffective: 300,
        storedEffective: 256, storedTotalEffective: 364,
        immediateMissingRaw: 0, missingRaw: 0, decompressionBlocked: false, readyToReserve: true,
        b2Crafts: 16, b3Crafts: 1, vaultB2: 32, vaultB3: 2, inventoryB2: 16, inventoryB3: 0,
        compactableB1: true, plannedB2Exact: 16
    });
    const snapshot = JSON.stringify(legacy);
    const generic = fromLegacyChain(legacy);
    assert.equal(JSON.stringify(legacy), snapshot);
    assert.equal(Object.isFrozen(generic), true);
    assert.deepEqual(generic, {
        baseId: 'coal', intermediateId: 'refined_coal', outputId: 'refined_coal_block',
        intermediateRecipeId: 'refined_coal', outputRecipeId: 'refined_coal_block',
        intermediateCrafts: 16, outputCrafts: 1,
        vaultIntermediate: 32, vaultOutput: 2, inventoryIntermediate: 16, inventoryOutput: 0,
        intermediatePerOutput: 16, intermediateOutputAmount: 1,
        basePerOutput: 256, baseNeededFromStorage: 128,
        storedLoose: 12, inventoryBase: 64, storageEffective: 192, storageTotalEffective: 300,
        storedEffective: 256, storedTotalEffective: 364,
        immediateMissingRaw: 0, missingRaw: 0, decompressionBlocked: false, readyToReserve: true
    });
    assert.ok(!('b2Id' in generic) && !('b3Id' in generic) && !('b2Crafts' in generic) && !('b3Crafts' in generic));
    assert.ok(!('compactableB1' in generic) && !('plannedB2Exact' in generic));
    assert.equal(isGenericChain(generic), true);
    assert.equal(isGenericChain(legacy), false);
    assert.equal(isGenericChain({ intermediateId: 'a' }), false);
});

test('step1: adapter output equals live generic planning chain on same input', async () => {
    const recipes = {
        b2: { output: 'b2', outputAmount: 1, inputs: { b1: 16 } },
        b3: { output: 'b3', outputAmount: 1, inputs: { b2: 16 } },
        b5: { output: 'b5', outputAmount: 1, inputs: { b3: 2 } }
    };
    const recipeRegistry = new CraftingRecipeRegistry(recipes);
    const materialCalculator = new MaterialCalculator({ recipeRegistry });
    const planner = new CraftingPlanner({ recipeRegistry, materialCalculator });
    const tiers = { B1: ['b1'], B2: ['b2'], B3: ['b3'], B4: [], B5: ['b5'] };
    const planning = new CraftPlanningService({
        planner, materialCalculator, recipeRegistry, tiers,
        storageMaterials: { effectiveItems: items => ({ ...items }), craftableItems: snapshot => ({ ...(snapshot?.items || {}) }) },
        inventoryCounter: { count: () => 0 },
        readFlows: {
            storage: { read: async () => ({ success: true, data: new KhoSnapshot({ items: { b1: 256 } }) }) },
            personalVault: { read: async () => ({ success: true, data: new PersonalVaultSnapshot({ totals: {}, slotCount: 54, emptySlotCount: 10 }) }) },
            inventory: { readViews: () => [{ source: 'bot-inventory', items: [], emptySlotCount: 36 }] }
        },
        config: { supplyMode: 'continuous', inputSource: 'storage', vaultBackpressure: { minEmptySlots: 3 } }
    });
    const compat = new B5PlanningService({ planning, tiers, targetId: 'b5' });
    const legacyResult = await compat.inspectAdditional(1);
    assert.equal(legacyResult.success, true);
    const legacyChain = legacyResult.data.chains[0];
    const adapted = fromLegacyChain(legacyChain);
    const genericResult = await planning.inspectAdditional('b5', 1);
    const genericChain = genericResult.data.chains[0];
    assert.deepEqual(adapted, genericChain);
});

test('step1: adapter handles missing/optional fields deterministically', () => {
    const first = fromLegacyChain({ baseId: 'coal' });
    const second = fromLegacyChain({ baseId: 'coal' });
    assert.deepEqual(first, second);
    assert.equal(first.intermediateId, null);
    assert.equal(first.intermediateCrafts, 0);
    assert.equal(first.intermediateOutputAmount, 1);
    assert.equal('storedEffective' in first, false);
    assert.equal(fromLegacyChain(null).baseId, null);
    assert.equal(fromLegacyChain({ baseId: '  coal  ', b2Id: '  b2  ' }).baseId, 'coal');
});
