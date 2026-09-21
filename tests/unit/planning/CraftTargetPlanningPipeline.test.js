'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ItemRegistry = require('../../../src/items/ItemRegistry');
const CraftingItemRegistry = require('../../../src/items/CraftingItemRegistry');
const CraftingRequest = require('../../../src/items/CraftingRequest');
const CraftingRecipeRegistry = require('../../../src/server-features/crafting/CraftingRecipeRegistry');
const CraftPlanningService = require('../../../src/server-features/crafting/CraftPlanningService');
const MaterialCalculator = require('../../../src/planning/crafting/MaterialCalculator');
const CraftingPlanner = require('../../../src/planning/crafting/CraftingPlanner');
const CraftingChainPlanner = require('../../../src/planning/crafting/CraftingChainPlanner');
const CraftStageClassifier = require('../../../src/planning/crafting/CraftStageClassifier');
const B5Planner = require('../../../src/planning/crafting/B5Planner');

const ITEMS = require('../../../config/items/items.json');
const RECIPES = require('../../../config/server-data/recipes.json');
const TIERS = require('../../../config/server-data/crafting-tiers.json');

// One generic pipeline, no per-target code path: a refined block, the B4 items
// and the B5 item are all resolved by the same planner from recipes.json + tiers.
const GENERIC_TARGETS = Object.freeze(['refined_iron_block', 'carbon', 'titanium', 'tungsten', 'super_alloy']);

function createPipeline({ recipes = RECIPES, items = ITEMS, tiers = TIERS } = {}) {
    const recipeRegistry = new CraftingRecipeRegistry(recipes);
    const materialCalculator = new MaterialCalculator({ recipeRegistry });
    const craftingPlanner = new CraftingPlanner({ recipeRegistry, materialCalculator });
    return {
        recipeRegistry,
        materialCalculator,
        craftingPlanner,
        craftingItemRegistry: new CraftingItemRegistry({
            itemRegistry: new ItemRegistry(items),
            recipeRegistry,
            tiers
        }),
        planning: new CraftPlanningService({ planner: craftingPlanner })
    };
}

// Expected production order straight from the recipe graph (post-order DFS, the
// same contract CraftingPlanner implements) — no item list is hard-coded here.
function expectedOutputs(recipes, targetId) {
    const byOutput = new Map(Object.values(recipes).map(recipe => [recipe.output, recipe]));
    const outputs = [];
    const seen = new Set();
    const walk = itemId => {
        if (seen.has(itemId)) return;
        const recipe = byOutput.get(itemId);
        if (!recipe) return;
        seen.add(itemId);
        for (const inputId of Object.keys(recipe.inputs || {})) walk(inputId);
        outputs.push(itemId);
    };
    walk(targetId);
    return outputs;
}

function tierOf(itemId) {
    for (const [tier, ids] of Object.entries(TIERS)) {
        if (ids.includes(itemId)) return tier;
    }
    return null;
}

test('one generic pipeline plans the full chain of every configured target', () => {
    const { planning, materialCalculator } = createPipeline();

    for (const targetId of GENERIC_TARGETS) {
        const expected = expectedOutputs(RECIPES, targetId);
        const plan = planning.plan(targetId, 1);

        assert.equal(plan.targetId, targetId, `plan must keep the requested target (${targetId})`);
        assert.deepEqual(plan.steps.map(step => step.outputId), expected, `${targetId} chain must follow the recipe graph`);
        assert.equal(plan.steps.at(-1).outputId, targetId, `${targetId} must be produced last`);
        assert.ok(plan.steps.every(step => step.crafts > 0));
        assert.deepEqual(plan.baseMaterials, materialCalculator.requirements(targetId, 1));
        assert.deepEqual(plan.missing, plan.baseMaterials, 'no stock means every base material is missing');
        assert.equal(plan.feasible, false);
    }
});

test('planning another target never drags B5 items into the chain', () => {
    const { planning } = createPipeline();

    for (const targetId of GENERIC_TARGETS) {
        const outputs = planning.plan(targetId, 1).steps.map(step => step.outputId);
        if (targetId === 'super_alloy') {
            assert.ok(outputs.includes('super_alloy'));
            continue;
        }
        assert.equal(outputs.includes('super_alloy'), false, `${targetId} chain must not contain super_alloy`);
    }

    const titanium = planning.plan('titanium', 1).steps.map(step => step.outputId);
    assert.equal(titanium.includes('tungsten'), false);
    assert.equal(titanium.includes('carbon'), false);
});

test('quantity and available state flow through the same pipeline for any target', () => {
    const { planning, craftingPlanner, materialCalculator } = createPipeline();

    const twoCarbon = planning.plan('carbon', 2);
    assert.equal(twoCarbon.steps.at(-1).crafts, 2);
    assert.deepEqual(twoCarbon.baseMaterials, materialCalculator.requirements('carbon', 2));

    // Frozen caller-owned state: a planner that mutated it would throw here.
    const available = Object.freeze({ iron_ingot: 64 * 16 });
    const satisfied = planning.plan('refined_iron_block', 1, available);
    assert.deepEqual(available, { iron_ingot: 1024 });
    assert.equal(satisfied.feasible, true);
    assert.deepEqual(satisfied.missing, {});
    assert.deepEqual(satisfied.steps.map(step => [step.outputId, step.crafts]), [['refined_iron', 16], ['refined_iron_block', 1]]);
    assert.equal(satisfied.availableUsed.iron_ingot, 1024);

    const partial = planning.plan('titanium', 1, Object.freeze({ iron_ingot: 64 }));
    assert.equal(partial.steps.at(-1).outputId, 'titanium');
    assert.deepEqual(partial, craftingPlanner.plan('titanium', 1, { iron_ingot: 64 }));
});

test('the target is explicit: no ambient or super_alloy default exists', () => {
    const { planning, craftingPlanner, craftingItemRegistry } = createPipeline();

    assert.throws(() => new CraftPlanningService({}), /planner\.plan is required/);
    assert.throws(() => planning.plan(), /targetId is required/);
    assert.throws(() => planning.plan('', 1), /targetId is required/);
    assert.throws(() => planning.plan('   ', 1), /targetId is required/);
    assert.throws(() => planning.plan(null, 1), /targetId is required/);
    assert.throws(() => planning.plan('super_alloy', 0), RangeError);

    const chainPlanner = new CraftingChainPlanner({ craftingPlanner, craftingItemRegistry });
    assert.throws(() => chainPlanner.plan({}), TypeError);
    const request = CraftingRequest.create({ targetItemId: 'titanium', quantity: 2, itemRegistry: craftingItemRegistry });
    assert.equal(chainPlanner.plan({ request }).targetItemId, 'titanium');
});

test('stage kinds come from output metadata, not from hard-coded target names', () => {
    const { planning } = createPipeline();
    const plan = planning.plan('titanium', 1);

    const classifier = new CraftStageClassifier({ tiers: TIERS, reserveTiers: ['B2', 'B3'], targetKind: 'TARGET' });
    assert.equal(classifier.stageKind('titanium', 'titanium'), 'TARGET');
    assert.equal(classifier.kindOf('titanium'), tierOf('titanium'));
    assert.equal(classifier.kindOf('refined_lapis_block'), tierOf('refined_lapis_block'));
    assert.equal(classifier.kindOf('not_a_known_item'), 'INTERMEDIATE');

    const { reserveSteps, finalSteps } = classifier.partition(plan);
    assert.equal(reserveSteps.length + finalSteps.length, plan.steps.length);
    assert.ok(reserveSteps.every(step => ['B2', 'B3'].includes(tierOf(step.outputId))));
    assert.ok(finalSteps.some(step => step.outputId === 'titanium'));

    // Same plan, different configured reserve tiers: classification is policy
    // data, never a hard-coded B2/B3 (or B5/B4) assumption.
    const withoutReserve = new CraftStageClassifier({ tiers: TIERS, reserveTiers: [] });
    assert.deepEqual(withoutReserve.partition(plan).reserveSteps, []);
    assert.equal(withoutReserve.partition(plan).finalSteps.length, plan.steps.length);

    // The B5 boundary delegates to this classifier instead of re-implementing it.
    const b5Plan = planning.plan('super_alloy', 1);
    const b5Planner = new B5Planner({ planner: planning.planner, targetId: 'super_alloy', tiers: TIERS });
    assert.deepEqual(
        b5Planner.partition(b5Plan).reserveSteps.map(step => step.outputId),
        classifier.partition(b5Plan).reserveSteps.map(step => step.outputId)
    );
});

test('a new target only needs recipe/item data, never workflow code', () => {
    const futureRecipes = {
        ...RECIPES,
        future_alloy: {
            output: 'future_alloy',
            outputAmount: 1,
            menuItemId: 'future_alloy',
            menuSlot: 34,
            inputs: { titanium: 1, carbon: 2 }
        }
    };
    const futureItems = {
        ...ITEMS,
        future_alloy: {
            representations: {
                default: { rules: [{ type: 'name', value: 'Future Alloy' }] },
                inventory: { rules: [{ type: 'identity', value: 'MMOITEMS_ITEM_ID:FUTUREALLOY' }] },
                'personal-vault': { rules: [{ type: 'identity', value: 'MMOITEMS_ITEM_ID:FUTUREALLOY' }] }
            }
        }
    };
    const futureTiers = { ...TIERS, B5: [...TIERS.B5, 'future_alloy'] };

    const { planning, craftingItemRegistry, materialCalculator } = createPipeline({ recipes: futureRecipes, items: futureItems, tiers: futureTiers });
    const expected = expectedOutputs(futureRecipes, 'future_alloy');
    const plan = planning.plan('future_alloy', 3);

    assert.equal(plan.targetId, 'future_alloy');
    assert.deepEqual(plan.steps.map(step => step.outputId), expected);
    assert.equal(plan.steps.at(-1).outputId, 'future_alloy');
    assert.deepEqual(plan.missing, materialCalculator.requirements('future_alloy', 3));
    assert.equal(plan.missing.titanium, undefined, 'craftable inputs are not reported as missing raw material');
    assert.equal(plan.missing.carbon, undefined);
    assert.ok(plan.missing.iron_ingot > 0);
    assert.equal(expected.includes('super_alloy'), false);

    const request = CraftingRequest.create({ targetItemId: 'future_alloy', quantity: 3, itemRegistry: craftingItemRegistry });
    const chain = new CraftingChainPlanner({ craftingPlanner: planning.planner, craftingItemRegistry }).plan({ request });
    assert.equal(chain.targetItemId, 'future_alloy');
    assert.equal(chain.steps.at(-1).tier, 'B5');
});

