'use strict';

// G16 - generic storage/input acquisition boundary.
// Policy resolves inventory vs storage per material; availability is
// determined before withdrawal/craft; withdrawal failure never passes as
// prepared input; shared storage primitives keep working.
const test = require('node:test');
const assert = require('node:assert/strict');

const Result = require('../../../src/shared/result/Result');
const CraftInputSourcePolicy = require('../../../src/server-features/crafting/support/CraftInputSourcePolicy');
const CraftInputAcquisitionFlow = require('../../../src/server-features/crafting/flows/CraftInputAcquisitionFlow');
const CraftBaseInventoryCoordinator = require('../../../src/server-features/crafting/coordinators/CraftBaseInventoryCoordinator');
const CraftStorageFlow = require('../../../src/server-features/crafting/flows/CraftStorageFlow');
const CraftAutomationService = require('../../../src/server-features/crafting/CraftAutomationService');

function chain() {
  return { baseId: 'iron_ingot', intermediateId: 'refined_iron', intermediateRecipeId: 'refined_iron', intermediatePerOutput: 1, outputId: 'refined_iron' };
}

function context() {
  return { cancellation: { token: { throwIfCancelled() {} } }, connectionGeneration: 3, trace: null };
}

function coordinator({ source = 'inventory', withdrawResult = null, counts = {} } = {}) {
  const withdrawn = [];
  const storage = {
    async withdrawB1(id, options) {
      withdrawn.push({ id, requiredAmount: options?.requiredAmount });
      return withdrawResult || Result.ok({ moved: options?.requiredAmount || 0 });
    }
  };
  const countsState = { ...counts };
  const coord = new CraftBaseInventoryCoordinator({
    storageFlow: { async returnBaseInventory() { return Result.ok({ ready: true, moved: 0 }); } },
    inputAcquisition: new CraftInputAcquisitionFlow({ storage, source }),
    inventoryState: {
      count: id => Number(countsState[id] || 0),
      spaceSnapshot: () => ({ emptySlotCount: 10 }),
      waitForIncrease: async id => Number(countsState[id] || 0)
    },
    recipeRegistry: { require: () => ({ inputs: { iron_ingot: 64 } }) },
    config: { inputSource: source },
    runStep: async (_ctx, _meta, fn) => fn(),
    childOptions: (_ctx, extra) => extra || {},
    verificationService: { requireInputReady() {}, handoff: () => ({ ready: true }) }
  });
  return { coord, withdrawn, countsState };
}


test('G16 policy: default storage, inventory default, per-material overrides, legacy key', () => {
  assert.equal(CraftInputSourcePolicy.fromConfig({}).resolve('iron_ingot'), 'storage');
  assert.equal(CraftInputSourcePolicy.fromConfig({ inputSource: 'inventory' }).resolve('x'), 'inventory');
  assert.equal(CraftInputSourcePolicy.fromConfig({ b2InputSource: 'inventory' }).resolve('x'), 'inventory');
  const mixed = CraftInputSourcePolicy.fromConfig({ inputSource: 'storage', inputSourceOverrides: { iron_ingot: 'inventory' } });
  assert.equal(mixed.resolve('iron_ingot'), 'inventory');
  assert.equal(mixed.resolve('coal'), 'storage');
  assert.equal(mixed.isInventory('iron_ingot'), true);
  assert.equal(mixed.isInventory('coal'), false);
});

test('G16 sufficient inventory: no withdrawal call, ready from stock', async () => {
  const { coord, withdrawn } = coordinator({ source: 'inventory', counts: { iron_ingot: 128 } });
  const result = await coord.acquire(chain(), context(), { intermediateRemaining: 1, minFreeForOutputAll: 1 });
  assert.equal(result.ready, true);
  assert.deepEqual(withdrawn, [], 'sufficient stock must not trigger withdrawal');
  assert.equal(result.craftable, 2);
});

test('G16 missing inputs acquired from storage-withdrawal when source=inventory', async () => {
  const withdrawn = [];
  const delivered = {};
  const storage = {
    async withdrawB1(id, options) {
      withdrawn.push({ id, requiredAmount: options?.requiredAmount });
      delivered[id] = Number(options?.requiredAmount || 0);
      return Result.ok({ moved: delivered[id] });
    }
  };
  const countsState = { iron_ingot: 0 };
  const reconciled = [];
  const coord = new CraftBaseInventoryCoordinator({
    storageFlow: { async returnBaseInventory() { return Result.ok({ ready: true, moved: 0 }); } },
    inputAcquisition: new CraftInputAcquisitionFlow({ storage, source: 'inventory' }),
    inventoryState: {
      count: id => Number(countsState[id] || 0) + Number(delivered[id] || 0),
      spaceSnapshot: () => ({ emptySlotCount: 10 }),
      waitForIncrease: async (id, before) => { reconciled.push({ id, before }); return 64; }
    },
    recipeRegistry: { require: () => ({ inputs: { iron_ingot: 64 } }) },
    config: { inputSource: 'inventory' },
    runStep: async (_ctx, _meta, fn) => fn(),
    childOptions: (_ctx, extra) => extra || {},
    verificationService: { requireInputReady() {}, handoff: () => ({ ready: true }) }
  });
  const result = await coord.acquire(chain(), context(), { intermediateRemaining: 1, minFreeForOutputAll: 1 });
  assert.equal(result.ready, true);
  assert.equal(withdrawn.length, 1);
  assert.equal(withdrawn[0].id, 'iron_ingot');
  assert.ok(withdrawn[0].requiredAmount >= 64);
  assert.deepEqual(reconciled, [{ id: 'iron_ingot', before: 0 }], 'inventory must be reconciled after withdrawal before crafting');
});

test('G16 insufficient storage: withdrawal failure blocks crafting, never reports ready', async () => {
  const { coord } = coordinator({
    source: 'inventory', counts: { iron_ingot: 0 },
    withdrawResult: Result.fail('FAILED', 'not enough', new Error('short'))
  });
  await assert.rejects(
    () => coord.acquire(chain(), context(), { intermediateRemaining: 1, minFreeForOutputAll: 1 }),
    error => /CRAFT_B1_WITHDRAW_FAILED/.test(error?.code || '')
  );
});

test('G16 uncertain withdrawal outcome surfaces, does not proceed silently', async () => {
  const { coord } = coordinator({
    source: 'inventory', counts: { iron_ingot: 0 },
    withdrawResult: { success: false, status: 'TIMEOUT', message: 'no confirm', error: new Error('timeout') }
  });
  await assert.rejects(
    () => coord.acquire(chain(), context(), { intermediateRemaining: 1, minFreeForOutputAll: 1 }),
    error => error?.code === 'CRAFT_B1_WITHDRAW_FAILED'
  );
});

test('G16 storage source: no withdrawal, planned availability asserted ready', async () => {
  const { coord, withdrawn } = coordinator({ source: 'storage', counts: { iron_ingot: 0 } });
  const result = await coord.acquire(chain(), context(), { intermediateRemaining: 2, minFreeForOutputAll: 1 });
  assert.equal(result.ready, true);
  assert.equal(result.source, 'storage');
  assert.deepEqual(withdrawn, [], 'storage source prepares in /kho; no inventory withdrawal');
});

test('G16 acquisition flow routes per-material policy, not global default', async () => {
  const calls = [];
  const flow = new CraftInputAcquisitionFlow({
    storage: { async withdrawB1(id, options) { calls.push(id); return Result.ok({ moved: 1 }); } },
    inputSourcePolicy: CraftInputSourcePolicy.fromConfig({ inputSource: 'storage', inputSourceOverrides: { iron_ingot: 'inventory' } })
  });
  assert.equal(flow.sourceFor('iron_ingot'), 'inventory');
  assert.equal(flow.sourceFor('coal'), 'storage');
  await flow.acquire('iron_ingot', 5, {});
  assert.deepEqual(calls, ['iron_ingot']);
  const noWithdraw = await flow.acquire('coal', 5, {});
  assert.equal(noWithdraw.success, true);
  assert.equal(noWithdraw.data.withdrawalRequired, false);
  assert.deepEqual(calls, ['iron_ingot'], 'storage material must not withdraw');
});

test('G16 generic boundary keys: storageMaterials + inputAcquisition aliases share instances', () => {
  const readiness = { storage: null, logger: null, compact() {}, ensureBaseAvailable() {}, compactAll() {} };
  const storageFlow = new CraftStorageFlow({ storageMaterials: readiness });
  assert.equal(storageFlow.storageMaterials, readiness);
  assert.equal(storageFlow.b1Materials, readiness);
  assert.throws(() => new CraftStorageFlow({}), /storageMaterials is required/);
  const automation = new CraftAutomationService({
    planningService: { inspectAdditional: async () => ({ success: true, data: {} }) },
    crafting: { craft: async () => ({ success: true }) },
    personalVault: { deposit: async () => ({ success: true }), withdraw: async () => ({ success: true }) }, storage: {}, storageMaterials: readiness,
    inventoryReader: {}, inventoryCounter: {}, recipeRegistry: { require: () => ({}) },
    operationManager: null, config: {}, craftingVerificationService: { requireInputReady() {}, handoff: () => ({}), verifyOutput() {}, requireSettled() {} }
  });
  assert.equal(automation.storageMaterials, readiness);
  assert.equal(automation.b1Materials, readiness);
  assert.equal(automation.flows.inputAcquisition, automation.flows.b2Input);
  assert.equal(automation.flows.storage.storageMaterials, readiness);
});

test('G16 cancellation aborts acquisition before withdrawal side effects', async () => {
  const { coord, withdrawn } = coordinator({ source: 'inventory', counts: { iron_ingot: 0 } });
  const cancelled = { cancellation: { token: { throwIfCancelled() { throw Object.assign(new Error('stop'), { code: 'CANCELLED' }); } } }, connectionGeneration: 3, trace: null };
  await assert.rejects(() => coord.acquire(chain(), cancelled, { intermediateRemaining: 1, minFreeForOutputAll: 1 }), error => /CANCELLED/.test(error?.code || error?.message || ''));
  assert.deepEqual(withdrawn, [], 'cancelled acquisition must not withdraw');
});
