'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ItemRegistry = require('../../../src/items/ItemRegistry');
const CraftingItemRegistry = require('../../../src/items/CraftingItemRegistry');
const CraftingRequest = require('../../../src/items/CraftingRequest');
const CraftingRecipeRegistry = require('../../../src/server-features/crafting/CraftingRecipeRegistry');
const MaterialCalculator = require('../../../src/planning/crafting/MaterialCalculator');
const CraftingPlanner = require('../../../src/planning/crafting/CraftingPlanner');
const CraftingChainPlanner = require('../../../src/planning/crafting/CraftingChainPlanner');

const ITEMS = require('../../../config/items/items.json');
const RECIPES = require('../../../config/server-data/recipes.json');
const TIERS = require('../../../config/server-data/crafting-tiers.json');

function createDeps() {
    const itemRegistry = new ItemRegistry(ITEMS);
    const recipeRegistry = new CraftingRecipeRegistry(RECIPES);
    const materialCalculator = new MaterialCalculator({ recipeRegistry });
    const craftingPlanner = new CraftingPlanner({ recipeRegistry, materialCalculator });
    const craftingItemRegistry = new CraftingItemRegistry({ itemRegistry, recipeRegistry, tiers: TIERS });
    return { craftingPlanner, craftingItemRegistry };
}

function requestOf(targetItemId, quantity, registry) {
    return CraftingRequest.create({ targetItemId, quantity, itemRegistry: registry });
}

test('plans a single-tier B2 chain', () => {
    const { craftingPlanner, craftingItemRegistry } = createDeps();
    const planner = new CraftingChainPlanner({ craftingPlanner, craftingItemRegistry });
    const chain = planner.plan({ request: requestOf('super_cobblestone', 10, craftingItemRegistry), available: { cobblestone: 160 } });
    assert.equal(chain.targetItemId, 'super_cobblestone');
    assert.equal(chain.requiredQuantity, 10);
    assert.equal(chain.steps.length, 1);
    assert.equal(chain.steps[0].outputId, 'super_cobblestone');
    assert.equal(chain.steps[0].tier, 'B2');
    assert.equal(chain.steps[0].crafts, 10);
    assert.deepEqual(chain.intermediates, []);
    assert.deepEqual(chain.finalMaterials, { cobblestone: 160 });
    assert.equal(chain.feasible, true);
});

test('without stock, raw B1 materials are reported as missing', () => {
    const { craftingPlanner, craftingItemRegistry } = createDeps();
    const planner = new CraftingChainPlanner({ craftingPlanner, craftingItemRegistry });
    const chain = planner.plan({ request: requestOf('super_cobblestone', 10, craftingItemRegistry) });
    assert.equal(chain.feasible, false);
    assert.deepEqual(chain.missing, { cobblestone: 160 });
});

test('plans a B3 chain through its B2 intermediate', () => {
    const { craftingPlanner, craftingItemRegistry } = createDeps();
    const planner = new CraftingChainPlanner({ craftingPlanner, craftingItemRegistry });
    const chain = planner.plan({ request: requestOf('refined_iron_block', 1, craftingItemRegistry) });
    assert.ok(chain.steps.some(step => step.outputId === 'refined_iron'));
    assert.deepEqual(chain.finalMaterials, { iron_ingot: 64 * 16 });
    assert.ok(chain.intermediates.includes('refined_iron'));
});

test('plans a multi-tier B4 chain', () => {
    const { craftingPlanner, craftingItemRegistry } = createDeps();
    const planner = new CraftingChainPlanner({ craftingPlanner, craftingItemRegistry });
    const chain = planner.plan({ request: requestOf('titanium', 2, craftingItemRegistry) });
    const outputs = chain.steps.map(step => step.outputId);
    for (const id of ['refined_iron_block', 'refined_gold_block', 'refined_lapis_block', 'refined_emerald_block', 'refined_iron', 'refined_gold', 'refined_lapis', 'refined_emerald']) {
        assert.ok(outputs.includes(id), `chain must include ${id}`);
    }
    assert.ok(chain.steps.every(step => step.crafts > 0));
    assert.equal(chain.steps.at(-1).outputId, 'titanium');
    assert.ok(chain.finalMaterials.iron_ingot > 0);
});

test('plans the B5 chain for quantity 100 with all intermediates computed', () => {
    const { craftingPlanner, craftingItemRegistry } = createDeps();
    const planner = new CraftingChainPlanner({ craftingPlanner, craftingItemRegistry });
    const chain = planner.plan({ request: requestOf('super_alloy', 100, craftingItemRegistry), available: {
        cobblestone: 1, coal: 1, redstone: 1, lapis_lazuli: 1, iron_ingot: 1, gold_ingot: 1, diamond: 1, emerald: 1
    } });
    assert.equal(chain.requiredQuantity, 100);
    const byOutput = new Map(chain.steps.map(step => [step.outputId, step]));
    assert.equal(byOutput.get('super_alloy').crafts, 100);
    assert.equal(byOutput.get('tungsten').crafts, 800);
    assert.equal(byOutput.get('titanium').crafts, 1600);
    assert.equal(byOutput.get('carbon').crafts, 3200);
    // tiers flow down to B1 raw materials with no hard-coded item list here
    assert.ok(byOutput.get('refined_diamond').crafts > 0);
    assert.ok(chain.finalMaterials.diamond > 0);
    assert.equal(chain.steps.at(-1).tier, 'B5');
});

test('matches the existing CraftingPlanner behavior exactly (compat)', () => {
    const { craftingPlanner, craftingItemRegistry } = createDeps();
    const planner = new CraftingChainPlanner({ craftingPlanner, craftingItemRegistry });
    const direct = craftingPlanner.plan('super_alloy', 3, { diamond: 10 });
    const chain = planner.plan({ request: requestOf('super_alloy', 3, craftingItemRegistry), available: { diamond: 10 } });
    assert.deepEqual(chain.finalMaterials, direct.baseMaterials);
    assert.deepEqual(chain.missing, direct.missing);
    assert.deepEqual(chain.availableUsed, direct.availableUsed);
    assert.deepEqual(chain.remainingAvailable, direct.remainingAvailable);
    assert.deepEqual(chain.steps.map(s => [s.recipeId, s.outputId, s.crafts, s.inputs]), direct.steps.map(s => [s.recipeId, s.outputId, s.crafts, { ...s.inputs }]));
});

test('rejects ALL instead of looping forever', () => {
    const { craftingPlanner, craftingItemRegistry } = createDeps();
    const planner = new CraftingChainPlanner({ craftingPlanner, craftingItemRegistry });
    assert.throws(
        () => planner.plan({ request: requestOf('super_alloy', 'ALL', craftingItemRegistry) }),
        error => error.code === CraftingChainPlanner.UNBOUNDED && error.targetItemId === 'super_alloy'
    );
});

test('raw B1 target has no recipe and is reported as missing material', () => {
    const { craftingPlanner, craftingItemRegistry } = createDeps();
    const planner = new CraftingChainPlanner({ craftingPlanner, craftingItemRegistry });
    const chain = planner.plan({ request: requestOf('diamond', 5, craftingItemRegistry) });
    assert.deepEqual(chain.steps, []);
    assert.deepEqual(chain.intermediates, []);
    assert.deepEqual(chain.finalMaterials, { diamond: 5 });
});

test('requires dependencies and returns immutable chains', () => {
    const { craftingPlanner, craftingItemRegistry } = createDeps();
    assert.throws(() => new CraftingChainPlanner({}), TypeError);
    assert.throws(() => new CraftingChainPlanner({ craftingPlanner }), TypeError);
    const planner = new CraftingChainPlanner({ craftingPlanner, craftingItemRegistry });
    assert.throws(() => planner.plan({}), TypeError);
    const chain = planner.plan({ request: requestOf('super_cobblestone', 1, craftingItemRegistry) });
    assert.throws(() => { chain.requiredQuantity = 2; }, TypeError);
});
