'use strict';

// G14.2 - procedure runtime production wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CraftingOperation = require('../../../src/server-features/crafting/CraftingOperation');
const CraftingProcedureRuntime = require('../../../src/server-features/crafting/CraftingProcedureRuntime');
const CraftingService = require('../../../src/server-features/crafting/CraftingService');
const CraftingRecipeRegistry = require('../../../src/server-features/crafting/CraftingRecipeRegistry');
const ProcedureRegistry = require('../../../src/server-features/crafting/procedure/ProcedureRegistry');

const PROCEDURES = require('../../../config/server-data/procedures.json');

function windowWith(id, size, entries = {}) {
  const slots = Array(size).fill(null);
  for (const [slot, item] of Object.entries(entries)) slots[Number(slot)] = item;
  return { id, title: 'window-' + id, slots, inventoryStart: size };
}

function sessionFor(window, definitionId) {
  return {
    active: true, definitionId, identity: { id: definitionId, confidence: 0.95 },
    source: null, window,
    setSource(source) { this.source = source; },
    setIdentity(identity) { this.identity = identity; this.definitionId = identity?.id || null; }
  };
}

function rig({ amount = 64, procedureId = 'minerals-crafting' } = {}) {
  const calls = [];
  const rootWindow = windowWith(1, 27, { 16: { displayName: 'menu_crafting' } });
  const menuWindow = windowWith(2, 54, { 10: { displayName: 'refined_iron' } });
  const quantityWindow = windowWith(3, 45, { 22: { displayName: 'craft 64' } });
  const bot = {
    currentWindow: null, inventory: { slots: [] },
    waitForTicks: async () => {}, closeWindow(window) { if (bot.currentWindow === window) bot.currentWindow = null; }
  };
  const root = sessionFor(rootWindow, 'minerals');
  const menu = sessionFor(menuWindow, 'crafting');
  const navigator = {
    openMineralsRoot: async () => root,
    assertGuiIdentity: () => {},
    resolveEntrySlot: async () => 16,
    resolveRecipeSlot: async () => 10,
    resolveRecipeSlotWithRetry: async () => 10,
    resolveQuantitySlot: async () => 22
  };
  const guiManager = {
    context: { require: () => bot },
    current: () => null,
    syncCurrentWindow: () => null,
    describeCurrent: () => ({}),
    performAndWaitForOpen: async action => { calls.push('open'); await action(); return { session: root }; },
    clickAndWaitForTransition: async (slot, options) => {
      calls.push('transition:' + slot);
      void options;
      if (slot === 16) return menu;
      if (slot === 10) return sessionFor(quantityWindow, 'craftingQuantity');
      return menu;
    },
    click: async slot => { calls.push('click:' + slot); },
    closeCurrentWindow: async () => { bot.currentWindow = null; return true; },
    waitFor: async () => null
  };
  const sender = async key => { calls.push('command:' + key); return { success: true }; };
  const runtime = new CraftingProcedureRuntime({ commandService: { send: sender }, guiManager, navigator });
  const operation = new CraftingOperation({
    commandService: { send: sender },
    guiManager,
    context: { require: () => bot },
    itemResolver: { matches: () => ({ matched: false }) },
    recipeRegistry: new CraftingRecipeRegistry({ refined_iron: { output: 'refined_iron', outputAmount: 1, menuItemId: 'refined_iron', menuSlot: 10, inputs: { iron_ingot: 64 }, procedure: procedureId } }),
    quantityResolver: { resolve: () => 22, describeCandidates: () => [] },
    resultVerifier: {
      before: () => ({ count: 0, countsBySource: { 'bot-inventory': 0 }, views: [], inputCounts: {} }),
      arm() {},
      after: async () => ({ verified: true, before: 0, after: amount, delta: amount, verificationMode: 'output-snapshot-delta', inputEvidence: [], eventEvidence: { outputDelta: amount } })
    },
    guiKnowledge: { learnBootstrapSlots: async () => {}, learnLogicalItem: async () => {} },
    procedureRegistry: new ProcedureRegistry(PROCEDURES),
    procedureRuntime: runtime,
    config: { commandKey: 'minerals', mineralsGuiId: 'minerals', guiId: 'crafting', quantityGuiId: 'craftingQuantity', entryMenuItemId: 'menu_crafting', entrySlot: 16, guiTimeoutMs: 100, resultDelayMs: 0, openSettleMs: 0, preQuantityClickTicks: 0, postQuantityClickTicks: 0 }
  });
  return { calls, operation, runtime, navigator, guiManager };
}

test('G14.2 production wiring: procedure navigation runs once, operation owns quantity + verification', async () => {
  const { calls, operation } = rig({ amount: 64 });
  const result = await operation.execute('refined_iron', 64);
  assert.equal(result.verification.verified, true);
  assert.equal(result.producedAmount, 64);
  assert.equal(result.actualCrafts, 64);
  assert.equal(result.entrySlot, 16);
  assert.equal(result.recipeSlot, 10);
  assert.equal(result.quantitySlot, 22);
  assert.ok(calls.includes('command:minerals'), calls.join(' -> '));
  assert.equal(calls.filter(c => c === 'transition:16').length, 1, calls.join(' -> '));
  assert.deepEqual(calls.filter(c => c.startsWith('click:')), ['click:22']);
});

test('G14.2 exact quantity: batch policy follows procedure capability (repeat/1 -> 3 singles)', async () => {
  const recipes = new CraftingRecipeRegistry({
    a: { output: 'a', outputAmount: 1, inputs: { raw: 1 }, procedure: 'forge-crafting' }
  });
  const procedures = new ProcedureRegistry(PROCEDURES);
  const crafted = [];
  const service = new CraftingService({
    operation: { async execute(recipeId, amount) { crafted.push(amount); return { actualCrafts: amount }; } },
    recipeRegistry: recipes,
    procedureRegistry: procedures
  });
  const result = await service.executeStep({ recipeId: 'a', outputId: 'a', crafts: 3 });
  assert.equal(result.success, true);
  assert.deepEqual(result.data.batches, [1, 1, 1]);
  assert.deepEqual(crafted, [1, 1, 1]);
  assert.equal(result.data.procedureMaxBatch, 1);
});

test('G14.2 reconciliation: verified output reported, never the requested amount', async () => {
  const { operation } = rig({ amount: 3 });
  const result = await operation.execute('refined_iron', 3, { outputAmount: 1 });
  assert.equal(result.verification.verified, true);
  assert.equal(result.producedAmount, 3);
  assert.equal(result.actualCrafts, 3);
  assert.equal(result.amount, 3);
});

test('G14.2 terminal failure: failing command rejects instead of reporting success', async () => {
  const { operation } = rig();
  const failing = async () => ({ success: false, error: new Error('send failed') });
  operation.commandService.send = failing;
  operation.procedureRuntime.commandService.send = failing;
  await assert.rejects(() => operation.execute('refined_iron', 1), error => /CRAFTING_PROCEDURE_COMMAND_FAILED/.test(error?.code || ''));
});

test('G14.2 fail-closed: verification steps are not executed as fake success', async () => {
  const { runtime } = rig();
  const state = {
    context: { resolve: value => value }, session: sessionFor(windowWith(9, 27), 'minerals'),
    entrySlot: null, recipeSlot: null, foundSlot: null, enteredMenu: false, selectedRecipe: false,
    commandResult: null, trace: () => {}, flow: null, cancellationToken: null, expectedGeneration: null,
    operationContext: null, config: {}
  };
  await assert.rejects(
    () => runtime.runStep({ type: 'verify-quantity', amount: 5 }, state, { recipe: { output: 'x' }, options: {} }),
    error => error?.code === 'CRAFTING_PROCEDURE_STEP_NOT_OWNED'
  );
});

test('G14.2 composition root: runtime built with capability owners', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../src/bootstrap/registerBotServices.js'), 'utf8');
  assert.match(source, /new CraftingProcedureRuntime\(\{\s*commandService,\s*guiManager,\s*navigator:\s*craftingOperation\.navigator/);
  assert.match(source, /crafting\.procedureRegistry\s*=\s*procedureRegistry/);
  assert.match(source, /crafting\.recipeRegistry\s*=\s*recipeRegistry/);
  assert.match(source, /craftingOperation\.procedureRuntime\s*=/);
});



test('G21.1 recorded clicks resolve then click through the runtime capability', async () => {
  const { runtime, navigator, guiManager } = rig();
  navigator.resolveLogicalSlot = async () => 22;
  const clicked = [];
  const observed = guiManager.clickAndWaitForTransition;
  guiManager.clickAndWaitForTransition = async (slot, options) => {
    clicked.push(slot);
    return observed(slot, options);
  };
  const state = {
    context: { resolve: value => value }, session: sessionFor(windowWith(3, 45, { 22: { displayName: 'craft 64' } }), 'craftingQuantity'),
    entrySlot: null, recipeSlot: null, foundSlot: null, enteredMenu: true, selectedRecipe: true,
    commandResult: null, trace: () => {}, flow: null, cancellationToken: null, expectedGeneration: null,
    operationContext: null, config: {}
  };
  const recipe = { output: 'x' };
  await runtime.runStep({ type: 'find-logical-item', itemId: 'recorded-target' }, state, { recipe, options: {} });
  assert.equal(state.foundSlot, 22);
  await runtime.runStep({ type: 'click' }, state, { recipe, options: {} });
  assert.deepEqual(clicked, [22]);
  assert.equal(state.foundSlot, null);
});

test('G21.1 recorded quantity targets use the production quantity resolver', async () => {
  const { runtime, navigator } = rig();
  let seen = null;
  navigator.resolveQuantitySlot = async (session, amount) => { seen = amount; return 22; };
  const state = {
    context: { resolve: value => value }, session: sessionFor(windowWith(3, 45, { 22: { displayName: 'craft 64' } }), 'craftingQuantity'),
    entrySlot: null, recipeSlot: null, foundSlot: null, enteredMenu: true, selectedRecipe: true,
    commandResult: null, trace: () => {}, flow: null, cancellationToken: null, expectedGeneration: null,
    operationContext: null, config: {}
  };
  await runtime.runStep({ type: 'find-logical-item', itemId: 'quantity:64' }, state, { recipe: { output: 'x' }, options: {} });
  assert.equal(seen, 64);
  assert.equal(state.foundSlot, 22);
});

test('G21.1 unresolvable logical targets fail closed, never as fake slots', async () => {
  const { runtime, navigator } = rig();
  navigator.resolveLogicalSlot = async () => -1;
  const state = {
    context: { resolve: value => value }, session: sessionFor(windowWith(3, 45), 'craftingQuantity'),
    entrySlot: null, recipeSlot: null, foundSlot: null, enteredMenu: true, selectedRecipe: true,
    commandResult: null, trace: () => {}, flow: null, cancellationToken: null, expectedGeneration: null,
    operationContext: null, config: {}
  };
  await assert.rejects(
    () => runtime.runStep({ type: 'find-logical-item', itemId: 'ghost-target' }, state, { recipe: { output: 'x' }, options: {} }),
    error => error?.code === 'CRAFTING_PROCEDURE_TARGET_NOT_FOUND'
  );
});

test('G21.1 recording hands off through the G20 builder validation authority', () => {
  const ProcedureRecorder = require('../../../src/server-features/crafting/procedure/ProcedureRecorder');
  const ProcedureBuilderUseCases = require('../../../src/desktop/use-cases/ProcedureBuilderUseCases');
  const recorder = new ProcedureRecorder({
    resolveLogicalId: raw => (raw?.name === 'iron' ? 'menu_crafting' : null),
    sessionProvider: () => ({ window: { slots: { 11: { name: 'iron' } } } })
  });
  recorder.record({ kind: 'command', commandKey: 'minerals' });
  recorder.record({ kind: 'click', slot: 11, windowId: 'minerals' });
  const recorded = recorder.toProcedure({ id: 'recorded-g211' });
  assert.equal(recorded.unresolved.length, 0);
  const validation = new ProcedureBuilderUseCases().validate({
    id: recorded.id, steps: recorded.steps,
    label: recorded.label, description: recorded.description,
    quantityStrategy: recorded.quantityStrategy, maxBatch: recorded.maxBatch
  });
  assert.equal(validation.valid, true);
  assert.deepEqual(validation.normalized.steps, recorded.steps);
});


test('G14.2 cancellation: cancelled token aborts before any side effect', async () => {
  const { runtime } = rig();
  const state = {
    context: { resolve: value => value }, session: null,
    entrySlot: null, recipeSlot: null, foundSlot: null, enteredMenu: false, selectedRecipe: false,
    commandResult: null, trace: () => {}, flow: null,
    cancellationToken: { throwIfCancelled() { const error = new Error('cancelled'); error.code = 'CANCELLED'; throw error; } },
    expectedGeneration: null, operationContext: null, config: {}
  };
  await assert.rejects(
    () => runtime.runStep({ type: 'command', commandKey: 'minerals' }, state, { recipe: { output: 'x' }, options: {} }),
    error => error?.code === 'CANCELLED'
  );
});

test('G14.2 generation guard: stale connection generation aborts the step', async () => {
  const { runtime } = rig();
  const state = {
    context: { resolve: value => value }, session: sessionFor(windowWith(9, 27), 'minerals'),
    entrySlot: null, recipeSlot: null, foundSlot: null, enteredMenu: false, selectedRecipe: false,
    commandResult: null, trace: () => {}, flow: null, cancellationToken: null,
    expectedGeneration: 1, operationContext: { connectionGeneration: 2 }, config: {}
  };
  await assert.rejects(
    () => runtime.runStep({ type: 'wait', ms: 0 }, state, { recipe: { output: 'x' }, options: {} }),
    error => error?.code === 'GUI_STALE_GENERATION'
  );
});
