'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const CraftingRecipeRegistry = require('../../../src/server-features/crafting/CraftingRecipeRegistry');
const ProcedureRegistry = require('../../../src/server-features/crafting/procedure/ProcedureRegistry');
const ProcedureExecutor = require('../../../src/server-features/crafting/procedure/ProcedureExecutor');

const RECIPES = require('../../../config/server-data/recipes.json');
const PROCEDURES = require('../../../config/server-data/procedures.json');

async function runExecutor({ requested, failAt = -1, flakyOnce = false }) {
  const executor = new ProcedureExecutor({
    recipeRegistry: new CraftingRecipeRegistry(RECIPES),
    procedureRegistry: new ProcedureRegistry(PROCEDURES)
  });
  let stock = 0;
  let calls = 0;
  return executor.execute({
    recipeId: 'refined_iron',
    requested,
    handlers: {
      readOutput: async () => stock,
      executeBatch: async ({ crafts }) => {
        calls += 1;
        if (calls === failAt) throw Object.assign(new Error('boom'), { code: 'INJECTED' });
        if (flakyOnce && calls === 1) return { actualCrafts: 0, verified: false };
        stock += crafts;
        return { actualCrafts: crafts };
      }
    }
  });
}

test('exact execution: 137 completes across batches', async () => {
  const res = await runExecutor({ requested: 137 });
  assert.equal(res.requested, 137);
  assert.equal(res.actual, 137);
  assert.equal(res.remaining, 0);
  assert.equal(res.status, 'COMPLETED');
});

test('reconciliation: flaky batch reconciles; injected failure never reports success', async () => {
  const partial = await runExecutor({ requested: 10, flakyOnce: true });
  assert.ok(partial.actual <= 10);
  assert.ok(['COMPLETED', 'BLOCKED'].includes(partial.status));
  const failed = await runExecutor({ requested: 10, failAt: 1 });
  assert.notEqual(failed.status, 'COMPLETED');
  assert.ok(failed.remaining > 0);
});
