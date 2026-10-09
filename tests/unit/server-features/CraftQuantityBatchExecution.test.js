'use strict';

// G12.1 - quantity resolver hardening: any positive integer through verified
// button batches (1/64 from observed GUI capabilities), never ALL-as-default.
// Each batch is clicked and output-verified; success reports verified totals.
const test = require('node:test');
const assert = require('node:assert/strict');

const CraftingOperation = require('../../../src/server-features/crafting/CraftingOperation');
const CraftingQuantityResolver = require('../../../src/server-features/crafting/CraftingQuantityResolver');

function windowWith(id, size, entries = {}) {
  const slots = Array(size).fill(null);
  for (const [slot, item] of Object.entries(entries)) slots[Number(slot)] = item;
  return { id, title: 'window-' + id, slots, inventoryStart: size };
}

// Rig: /ks root -> crafting menu -> quantity menu (1-button + 64-button).
// Stock grows only by verified batch clicks; the verifier reports the live total.
function rig({ failBatchesAfter = Infinity } = {}) {
  const clicks = [];
  let stock = 0;
  const rootWindow = windowWith(1, 27, { 16: { displayName: 'menu_crafting' } });
  const menuWindow = windowWith(2, 54, { 10: { displayName: 'refined_iron' } });
  const quantityWindow = windowWith(3, 45, {
    20: { displayName: 'Craft 1', count: 1 },
    22: { displayName: 'Craft 64', count: 64 }
  });
  const bot = {
    currentWindow: null, inventory: { slots: [] },
    waitForTicks: async () => {}, closeWindow(window) { if (bot.currentWindow === window) bot.currentWindow = null; }
  };
  const quantitySession = {
    active: true, definitionId: 'craftingQuantity', identity: { id: 'craftingQuantity', confidence: 0.95 },
    source: null, window: quantityWindow,
    setSource(source) { this.source = source; },
    setIdentity(identity) { this.identity = identity; this.definitionId = identity?.id || null; }
  };
  const menuSession = {
    active: true, definitionId: 'crafting', identity: { id: 'crafting', confidence: 0.95 },
    source: null, window: menuWindow,
    setSource(source) { this.source = source; },
    setIdentity(identity) { this.identity = identity; this.definitionId = identity?.id || null; }
  };
  const guiManager = {
    context: { require: () => bot },
    current: () => null,
    syncCurrentWindow: () => null,
    describeCurrent: () => ({}),
    performAndWaitForOpen: async action => { await action(); return { session: { window: rootWindow } }; },
    clickAndWaitForTransition: async slot => {
      if (slot === 16) return menuSession;
      return quantitySession;
    },
    verifyIdentity: (expectedId, { session } = {}) => ({ matched: session?.definitionId === expectedId, identity: session?.identity || null, session }),
    click: async slot => {
      clicks.push(slot);
      if (clicks.length > failBatchesAfter) return;
      if (slot === 20) stock += 1;
      else if (slot === 22) stock += 64;
    },
    closeCurrentWindow: async () => true
  };
  const operation = new CraftingOperation({
    commandService: { send: async () => ({ success: true }) },
    guiManager,
    context: { require: () => bot },
    itemResolver: { matches: () => ({ matched: false }) },
    recipeRegistry: {
      require: () => ({ output: 'refined_iron', outputAmount: 1, menuItemId: 'refined_iron', menuSlot: 10, inputs: { iron_ingot: 1 } }),
      ids: () => ['refined_iron']
    },
    quantityResolver: new CraftingQuantityResolver({ quantitySlots: { 1: 20, 64: 22, ALL: 24 } }),
    resultVerifier: {
      before: () => ({ count: stock, countsBySource: { 'bot-inventory': stock }, views: [], inputCounts: {} }),
      arm() {},
      after: async (_output, before) => {
        const beforeCount = Number(before?.count || 0);
        return {
          verified: stock > beforeCount, before: beforeCount, after: stock, delta: stock - beforeCount,
          verificationMode: 'output-snapshot-delta', inputEvidence: [], eventEvidence: { outputDelta: stock - beforeCount }
        };
      }
    },
    guiKnowledge: {
      resolveSlot: async (_session, options) => {
        if (String(options?.roleId || '').startsWith('recipe:')) return 10;
        return 16;
      },
      learnBootstrapSlots: async () => {},
      learnSlot: async () => {},
      learnLogicalItem: async () => {}
    },
    config: { commandKey: 'minerals', mineralsGuiId: 'minerals', guiId: 'crafting', quantityGuiId: 'craftingQuantity', entryMenuItemId: 'menu_crafting', entrySlot: 16, guiTimeoutMs: 100, resultDelayMs: 0, openSettleMs: 0, preQuantityClickTicks: 0, postQuantityClickTicks: 0 }
  });
  return { clicks, operation, getStock: () => stock };
}

for (const amount of [1, 9, 64, 65, 137, 1000]) {
  test(`G12.1 exact quantity ${amount} completes through verified button batches`, async () => {
    const { clicks, operation } = rig();
    const result = await operation.execute('refined_iron', amount);
    assert.equal(result.actual, amount, `requested ${amount}: ${JSON.stringify(result.batches)}`);
    assert.equal(result.remaining, 0);
    assert.equal(result.requested, amount);
    // Batch math: 64s first, then 1s. 65 = 64+1, 137 = 64+64+9x1, 1000 = 15x64+40x1.
    const expected64 = Math.floor(amount / 64);
    const expected1 = amount % 64;
    assert.equal(clicks.filter(c => c === 22).length, expected64, `64-clicks for ${amount}: ${clicks}`);
    assert.equal(clicks.filter(c => c === 20).length, expected1, `1-clicks for ${amount}: ${clicks}`);
    assert.ok(!clicks.includes(24), `ALL must never satisfy exact ${amount}`);
    const wanted = result.batches.reduce((sum, b) => sum + b.wanted, 0);
    assert.equal(wanted, amount);
    assert.ok(result.batches.every(b => b.actual === b.wanted));
  });
}

test('G12.1 missing 64-button stays exact through the 1-button only', async () => {
  const { operation } = rig();
  // Hide the 64 button: resolver falls back to configured slots, but live
  // detection only sees the 1-button. Force it via a resolver without 64.
  operation.quantityResolver = new CraftingQuantityResolver({ quantitySlots: { 1: 20 } });
  const result = await operation.execute('refined_iron', 9);
  assert.equal(result.actual, 9);
  assert.equal(result.batches.length, 9);
  assert.ok(result.batches.every(b => b.wanted === 1 && b.actual === 1));
});

test('G12.1 no quantity buttons at all fails closed without side effects', async () => {
  const { clicks, operation } = rig();
  // Empty capability set: no live candidates, no configured fallback.
  operation.quantityResolver = { describeActions: () => [], describeCandidates: () => [], resolve: () => { throw new Error('unresolvable'); } };
  await assert.rejects(() => operation.execute('refined_iron', 5), error => /CRAFTING_QUANTITY_NOT_FOUND/.test(error?.code || ''));
  assert.deepEqual(clicks.filter(c => c === 20 || c === 22), [], 'no batch click may run without a resolved slot');
});

test('G12.1 partial success surfaces UNCERTAIN with reconciliation baseline, never requested-as-actual', async () => {
  // Server stops crediting after the first batch: 65 = 64 + 1, second click ignored.
  const { operation } = rig({ failBatchesAfter: 1 });
  await assert.rejects(() => operation.execute('refined_iron', 65), error => {
    // The existing uncertain-mutation contract owns this: no blind retry, the
    // caller reconciles from the baseline. Success is never reported.
    assert.equal(error?.code, 'CRAFTING_OUTCOME_UNCERTAIN');
    assert.equal(error?.retryable, false);
    assert.ok(error?.details?.reconciliationBaseline, 'reconciliation baseline must be present');
    return true;
  });
});

test('G12.1 resolver capabilities: live buttons win, ALL never listed', () => {
  const resolver = new CraftingQuantityResolver({ quantitySlots: { 1: 20, 64: 22, ALL: 24 } });
  const live = windowWith(7, 45, {
    20: { displayName: 'Craft 1', count: 1 },
    22: { displayName: 'Craft 64', count: 64 },
    24: { displayName: 'ALL', count: 1 }
  });
  const actions = resolver.describeActions(live);
  assert.deepEqual(actions.map(a => a.amount), [64, 1]);
  assert.ok(actions.every(a => a.source === 'live'));
  assert.ok(!actions.some(a => a.amount === 'ALL' || String(a.amount).toUpperCase() === 'ALL'));
  // Configured fallback still works when live text is indistinguishable.
  const generic = windowWith(8, 45, {
    20: { name: 'paper', count: 1, displayName: 'Craft' },
    22: { name: 'paper', count: 1, displayName: 'Craft' }
  });
  const fallback = new CraftingQuantityResolver({ quantitySlots: { 1: 20, 64: 22 } }).describeActions(generic);
  assert.deepEqual(fallback.map(a => a.amount), [64, 1]);
  assert.ok(fallback.every(a => a.source === 'configured'));
});
