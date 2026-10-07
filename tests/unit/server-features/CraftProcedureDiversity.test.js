'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const CraftingRecipeRegistry = require('../../../src/server-features/crafting/CraftingRecipeRegistry');
const ProcedureRegistry = require('../../../src/server-features/crafting/procedure/ProcedureRegistry');
const ProcedureExecutor = require('../../../src/server-features/crafting/procedure/ProcedureExecutor');

const PROCEDURES = require('../../../config/server-data/procedures.json');

test('procedure diversity: one executor runs command/GUI/click/wait/verify shapes', async () => {
  const recipes = new CraftingRecipeRegistry({
    a: { output: 'a', outputAmount: 1, inputs: { raw: 1 }, procedure: 'minerals-crafting' },
    b: { output: 'b', outputAmount: 1, inputs: { raw: 1 }, procedure: 'forge-crafting' },
    c: { output: 'c', outputAmount: 1, inputs: { raw: 1 }, procedure: 'npc-crafting' }
  });
  const procedures = new ProcedureRegistry(PROCEDURES);
  const executor = new ProcedureExecutor({ recipeRegistry: recipes, procedureRegistry: procedures });
  for (const [recipeId, procedureId] of [['a', 'minerals-crafting'], ['b', 'forge-crafting'], ['c', 'npc-crafting']]) {
    let stock = 0;
    const res = await executor.execute({
      recipeId,
      requested: 5,
      handlers: {
        readOutput: async () => stock,
        executeBatch: async ({ crafts }) => { stock += crafts; return { actualCrafts: crafts }; }
      }
    });
    assert.equal(res.procedureId, procedureId, `${recipeId} uses ${procedureId}`);
    assert.equal(res.status, 'COMPLETED');
    assert.equal(res.actual, 5);
  }
});
