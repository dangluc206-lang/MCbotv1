'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const CraftingRecipeRegistry = require('../../../src/server-features/crafting/CraftingRecipeRegistry');
const ProcedureRegistry = require('../../../src/server-features/crafting/procedure/ProcedureRegistry');
const ProcedureContext = require('../../../src/server-features/crafting/procedure/ProcedureContext');
const QuantityStrategy = require('../../../src/server-features/crafting/quantity/QuantityStrategy');
const CraftingPlanner = require('../../../src/planning/crafting/CraftingPlanner');
const MaterialCalculator = require('../../../src/planning/crafting/MaterialCalculator');

const RECIPES = require('../../../config/server-data/recipes.json');
const PROCEDURES = require('../../../config/server-data/procedures.json');

test('recipe valid: every recipe names an existing procedure', () => {
  const recipes = new CraftingRecipeRegistry(RECIPES);
  const procedures = new ProcedureRegistry(PROCEDURES);
  for (const id of recipes.ids()) {
    const recipe = recipes.require(id);
    assert.ok(recipe.output, `${id} needs output`);
    assert.ok(recipe.outputAmount >= 1, `${id} needs outputAmount`);
    assert.ok(Object.keys(recipe.inputs || {}).length > 0, `${id} needs inputs`);
    assert.ok(procedures.get(recipe.procedure), `${id} procedure must exist: ${recipe.procedure}`);
  }
});

test('recipe invalid: missing procedure fails closed', () => {
  const procedures = new ProcedureRegistry(PROCEDURES);
  assert.throws(() => procedures.require('no-such-procedure'), /Procedure not found/);
  assert.throws(() => new ProcedureRegistry({ bad: { steps: [] } }), /at least one step/);
  assert.throws(() => new ProcedureRegistry({ bad: { steps: [{ type: 'nope' }] } }), /unsupported type/);
});

test('planner: simple/nested/stock/missing/cycle/outputAmount>1', () => {
  const registry = new CraftingRecipeRegistry({
    a: { output: 'a', outputAmount: 1, inputs: { raw: 2 }, procedure: 'p' },
    b: { output: 'b', outputAmount: 1, inputs: { a: 3 }, procedure: 'p' },
    double: { output: 'double', outputAmount: 2, inputs: { raw: 2 }, procedure: 'p' }
  });
  const planner = new CraftingPlanner({ recipeRegistry: registry, materialCalculator: new MaterialCalculator({ recipeRegistry: registry }) });
  assert.equal(planner.plan('a', 5, { raw: 10 }).steps[0].crafts, 5);
  assert.equal(planner.plan('b', 2, {}).steps.find(s => s.outputId === 'a').crafts, 6);
  assert.equal(planner.plan('a', 5, { a: 2, raw: 6 }).steps[0].crafts, 3);
  assert.ok(planner.plan('a', 5, {}).missing.raw > 0);
  assert.equal(planner.plan('double', 3, { raw: 10 }).steps[0].crafts, 2);
  const cyclic = new CraftingRecipeRegistry({
    x: { output: 'x', outputAmount: 1, inputs: { y: 1 }, procedure: 'p' },
    y: { output: 'y', outputAmount: 1, inputs: { x: 1 }, procedure: 'p' }
  });
  assert.throws(() => new CraftingPlanner({
    recipeRegistry: cyclic, materialCalculator: new MaterialCalculator({ recipeRegistry: cyclic })
  }).plan('x', 1, {}), /cycle/);
});

test('quantity: 1/64/65/127/128/137/1000 stay exact', () => {
  const q = new QuantityStrategy();
  for (const n of [1, 64, 65, 127, 128, 137, 1000]) {
    const batches = q.plan({ requested: n, remaining: n, outputAmount: 1 });
    assert.equal(batches.reduce((sum, b) => sum + b.batchAmount, 0), n, `quantity ${n}`);
  }
  const single = q.plan({ requested: 137, remaining: 137, outputAmount: 1, capabilities: { strategy: 'command-quantity' } });
  assert.equal(single.length, 1);
  assert.equal(single[0].expectedOutput, 137);
});

test('procedure: registry validates steps; context resolves dynamic variables', () => {
  const procedures = new ProcedureRegistry(PROCEDURES);
  assert.ok(procedures.ids().includes('minerals-crafting'));
  assert.ok(procedures.ids().includes('forge-crafting'));
  assert.ok(procedures.ids().includes('npc-crafting'));
  const ctx = new ProcedureContext({
    request: { amount: 137 }, recipe: { output: 'refined_iron', outputAmount: 1 },
    procedure: { id: 'minerals-crafting' }, remaining: 73
  });
  assert.equal(ctx.resolve('$request.amount'), '137');
  assert.equal(ctx.resolve('$recipe.output'), 'refined_iron');
  assert.equal(ctx.resolve('$recipe.outputAmount'), '1');
  assert.equal(ctx.resolve('$execution.remaining'), '73');
});
