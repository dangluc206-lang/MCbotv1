'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Result = require('../../../src/shared/result/Result');
const FlowError = require('../../../src/shared/errors/FlowError');
const B5AutomationService = require('../../../src/server-features/crafting/B5AutomationService');
const Operation = require('../../../src/operations/Operation');
const OperationManager = require('../../../src/operations/OperationManager');
const OperationQueue = require('../../../src/operations/OperationQueue');
const OperationLockPolicy = require('../../../src/operations/OperationLockPolicy');
const OperationTimeoutPolicy = require('../../../src/operations/OperationTimeoutPolicy');

function operationManager() {
    return {
        async run(operation) {
            const token = { throwIfCancelled() {} };
            const data = await operation.executor({ cancellation: { token } });
            return Result.ok(data);
        }
    };
}

test('B5 root runs managed crafting/PV/storage children inline without nested queue deadlock', async () => {
    const manager = new OperationManager({
        botId: 'bot-01',
        queue: new OperationQueue({ maxPending: 8 }),
        lockPolicy: new OperationLockPolicy(),
        timeoutPolicy: new OperationTimeoutPolicy(),
        config: { defaultQueueWaitTimeoutMs: 50, defaultExecutionTimeoutMs: 500, shutdownDrainTimeoutMs: 100 }
    });
    const calls = [];
    let inspectCall = 0;

    const managedChild = (name, lockKeys, action) => async (...args) => {
        const options = args.at(-1) || {};
        assert.equal(manager.isContext(options.operationContext), true, `${name} must receive authorized parent context`);
        const result = await manager.run(new Operation({
            name,
            lockKeys,
            execute: context => context.step({ subsystem: 'test', step: name }, async () => action(...args))
        }), {
            operationContext: options.operationContext,
            cancellationToken: options.cancellationToken,
            connectionGeneration: options.expectedGeneration
        });
        calls.push(name);
        return result;
    };

    const planningService = {
        async inspectAdditional(_amount, options = {}) {
            assert.equal(manager.isContext(options.operationContext), true);
            inspectCall += 1;
            return Result.ok({
                personalVault: { totals: { super_alloy: 4 } },
                fullPlan: { targetId: 'super_alloy', feasible: true },
                finalSteps: [{ recipeId: 'super_alloy', crafts: 1 }],
                chains: []
            });
        }
    };

    const service = new B5AutomationService({
        planningService,
        crafting: { craft: managedChild('craft-child', ['crafting'], async () => ({ actualCrafts: 1 })) },
        personalVault: {
            deposit: managedChild('pv-deposit-child', ['personal-vault'], async () => ({ movedStacks: 1 })),
            read: managedChild('pv-read-child', ['personal-vault'], async () => ({ totals: { super_alloy: 5 } })),
            withdraw: managedChild('pv-withdraw-child', ['personal-vault'], async () => ({ movedStacks: 1 }))
        },
        storage: {},
        b1Materials: {
            compactAll: managedChild('storage-compact-child', ['storage'], async () => ({})),
            sellLargestStoredBlock: managedChild('storage-sell-child', ['storage'], async () => ({ sold: true })),
            ensureBaseAvailable: managedChild('storage-ensure-child', ['storage'], async () => ({})),
            compact: managedChild('storage-one-child', ['storage'], async () => ({}))
        },
        inventoryReader: { read: () => ({ emptySlotCount: 36 }) },
        inventoryCounter: { count: () => 0 },
        recipeRegistry: { require: () => ({ inputs: {} }) },
        operationManager: manager,
        context: { getGeneration: () => 1 },
        config: { timeoutMs: 500, inventorySafetyEmptySlots: 2 }
    });

    const result = await service.runNext({ expectedGeneration: 1 });
    assert.equal(result.success, true);
    assert.equal(inspectCall, 2);
    assert.deepEqual(calls, ['craft-child', 'pv-deposit-child', 'pv-read-child', 'storage-compact-child']);
    assert.equal(manager.snapshot().pending, 0);
    assert.equal(manager.snapshot().running, 0);
    assert.equal(manager.snapshot().active, 0);
    assert.equal(manager.lockPolicy.snapshot().length, 0);
    assert.equal(result.meta.trace.some(entry => entry?.step === 'craft-child'), true);
});

test('completed B5 deposits to /pv 2 and compacts B1 without selling during the craft campaign', async () => {
    const calls = [];
    let inspectCall = 0;
    const planningService = {
        async inspectAdditional() {
            inspectCall += 1;
            return Result.ok({
                personalVault: { totals: { super_alloy: 4 } },
                fullPlan: { targetId: 'super_alloy', feasible: true },
                finalSteps: [{ recipeId: 'super_alloy', crafts: 1 }],
                chains: []
            });
        }
    };
    const service = new B5AutomationService({
        planningService,
        crafting: {
            async craft(recipeId, amount) {
                calls.push(`craft:${recipeId}:${amount}`);
                return Result.ok({});
            }
        },
        personalVault: {
            async deposit(id) { calls.push(`deposit:${id}`); return Result.ok({}); },
            async read() { calls.push('pv-read'); return Result.ok({ totals: { super_alloy: 5 } }); },
            async withdraw() { return Result.ok({}); }
        },
        storage: {},
        b1Materials: {
            async ensureBaseAvailable() { return Result.ok({}); },
            async compact() { return Result.ok({}); },
            async compactAll() { calls.push('compact-all'); return Result.ok({}); },
            async sellLargestStoredBlock() { calls.push('sell-largest'); return Result.ok({ sold: true }); }
        },
        inventoryReader: { read: () => ({ emptySlotCount: 36 }) },
        inventoryCounter: { count: () => 0 },
        recipeRegistry: { require: () => ({ inputs: {} }) },
        operationManager: operationManager(),
        config: { timeoutMs: 1000, inventorySafetyEmptySlots: 2 }
    });

    const result = await service.runNext();
    assert.equal(result.success, true);
    assert.equal(result.data.completedNewB5, true);
    assert.equal(inspectCall, 2);
    assert.deepEqual(calls, [
        'craft:super_alloy:1',
        'deposit:super_alloy',
        'pv-read',
        'compact-all'
    ]);
});

test('partial reserve cycle crafts planned B2 before compacting B1 and returning to Collector', async () => {
    const calls = [];
    const activityLogs = [];
    let inspectCall = 0;
    const planningService = {
        async inspectAdditional() {
            inspectCall += 1;
            return Result.ok({
                personalVault: { totals: { super_alloy: 0 } },
                fullPlan: { targetId: 'super_alloy', feasible: false },
                finalSteps: [],
                chains: inspectCall === 1 ? [{
                    baseId: 'coal', b2Id: 'b2', b3Id: 'b3',
                    b2RecipeId: 'b2', b3RecipeId: 'b3',
                    b2OutputAmount: 1, b3InputPerCraft: 16,
                    rawNeededFromStorage: 16, readyToReserve: true,
                    b2Crafts: 1, b3Crafts: 0
                }] : []
            });
        }
    };
    const service = new B5AutomationService({
        planningService,
        crafting: { async craft() { calls.push('craft-b2'); return Result.ok({}); } },
        personalVault: {
            async deposit(id) { calls.push(`deposit:${id}`); return Result.ok({}); },
            async withdraw() { return Result.ok({}); }
        },
        storage: {},
        b1Materials: {
            async ensureBaseAvailable() { calls.push('base-ready'); return Result.ok({}); },
            async compact() { calls.push('compact-coal'); return Result.ok({}); },
            async compactAll() { calls.push('compact-all'); return Result.ok({}); },
            async sellLargestStoredBlock() { calls.push('sell-largest'); return Result.ok({}); }
        },
        inventoryReader: { read: () => ({ emptySlotCount: 36 }) },
        inventoryCounter: { count: () => 0 },
        recipeRegistry: { require: () => ({ inputs: {} }) },
        operationManager: operationManager(),
        config: { timeoutMs: 1000, inventorySafetyEmptySlots: 2 },
        logger: { info(message) { activityLogs.push(message); } }
    });

    const result = await service.runNext();
    assert.equal(result.success, true);
    assert.equal(result.data.completedNewB5, false);
    assert.equal(calls.includes('craft-b2'), true, 'a B2-only reserve plan must execute the planned B2 craft');
    assert.equal(calls.includes('compact-coal'), true);
    assert.equal(calls.includes('compact-all'), false, 'normal production must preserve unrelated loose B1 until pressure requires maintenance');
    assert.equal(calls.includes('sell-largest'), false);
    assert.equal(activityLogs.includes('B5: Đang chuẩn bị B2/B3.'), true);
    assert.equal(activityLogs.includes('B5: Đang chế B2.'), true);
    assert.equal(activityLogs.includes('B5: Đang chế B3.'), false, 'B2-only work must not be mislabeled as an actual B3 craft');
});

test('full B2 inventory frees one slot, then B3 ALL resumes without losing stored B2', async () => {
    const calls = [];
    let inspectCall = 0;
    const counts = { b2: 160, b3: 0 };
    const planningService = {
        async inspectAdditional() {
            inspectCall += 1;
            return Result.ok({
                personalVault: { totals: { super_alloy: 0 } },
                fullPlan: { targetId: 'super_alloy', feasible: false },
                finalSteps: [],
                chains: inspectCall === 1 ? [{
                    baseId: 'coal', b2Id: 'b2', b3Id: 'b3',
                    b2RecipeId: 'b2-recipe', b3RecipeId: 'b3-recipe',
                    b2OutputAmount: 1, b3InputPerCraft: 16,
                    rawNeededFromStorage: 0, readyToReserve: true,
                    b2Crafts: 0, b3Crafts: 10
                }] : []
            });
        }
    };
    const service = new B5AutomationService({
        planningService,
        crafting: {
            async craft(recipeId, quantity) {
                calls.push(`craft:${recipeId}:${quantity}`);
                if (recipeId === 'b3-recipe' && quantity === 'ALL') {
                    const crafts = Math.floor(counts.b2 / 16);
                    counts.b2 -= crafts * 16;
                    counts.b3 += crafts;
                    return Result.ok({ actualCrafts: crafts });
                }
                return Result.ok({ actualCrafts: Number(quantity) || 0 });
            }
        },
        personalVault: {
            async deposit(id, options = {}) {
                calls.push(`deposit:${id}`);
                if (id === 'b2' && options.maxStacks === 1 && counts.b2 >= 64) {
                    counts.b2 -= 64;
                    return Result.ok({ movedStacks: 1 });
                }
                return Result.ok({ movedStacks: 0 });
            },
            async withdraw(id) {
                calls.push(`withdraw:${id}`);
                if (id === 'b2') counts.b2 += 64;
                return Result.ok({ movedStacks: 1 });
            }
        },
        storage: {},
        b1Materials: {
            async ensureBaseAvailable() { return Result.ok({}); },
            async compact() { return Result.ok({}); },
            async compactAll() { return Result.ok({}); }
        },
        inventoryReader: { readBotInventory: () => ({ source: 'bot-inventory', emptySlotCount: Math.max(0, 3 - Math.ceil(counts.b2 / 64) - Math.ceil(counts.b3 / 64)), counts: { ...counts } }) },
        inventoryCounter: { count: (snapshot, id) => Number(snapshot.counts?.[id] || 0) },
        recipeRegistry: { require: () => ({ inputs: {} }) },
        operationManager: operationManager(),
        config: {
            targetId: 'super_alloy', timeoutMs: 1000, inventorySafetyEmptySlots: 2,
            quantityOptimization: { enabled: true, useAllForB2: true, useAllForB3: true, useAllForB4WhenExact: true, useAllForB5: false }
        }
    });

    const result = await service.runNext();
    assert.equal(result.success, true);
    assert.deepEqual(calls.filter(call => call.startsWith('deposit:b2') || call.startsWith('withdraw:b2') || call.startsWith('craft:b3')), [
        'deposit:b2',
        'craft:b3-recipe:ALL',
        'withdraw:b2',
        'craft:b3-recipe:ALL'
    ]);
    assert.equal(calls.some(call => call === 'craft:b2-recipe:ALL'), false);
});

test('reserve chain uses 64 for B1->B2 and ALL for B2->B3', async () => {
    const calls = [];
    let inspectCall = 0;
    const counts = { b2: 0, b3: 0 };
    const planningService = {
        async inspectAdditional() {
            inspectCall += 1;
            return Result.ok({
                personalVault: { totals: { super_alloy: 0 } },
                fullPlan: { targetId: 'super_alloy', feasible: false },
                finalSteps: [],
                chains: inspectCall === 1 ? [{
                    baseId: 'coal', b2Id: 'b2', b3Id: 'b3',
                    b2RecipeId: 'b2-recipe', b3RecipeId: 'b3-recipe',
                    b2OutputAmount: 1, b3InputPerCraft: 16,
                    rawNeededFromStorage: 128, readyToReserve: true,
                    b2Crafts: 128, b3Crafts: 8
                }] : []
            });
        }
    };
    const service = new B5AutomationService({
        planningService,
        crafting: {
            async craft(recipeId, quantity) {
                calls.push(`craft:${recipeId}:${quantity}`);
                if (recipeId === 'b2-recipe' && quantity === 64) {
                    counts.b2 += 64;
                    return Result.ok({ actualCrafts: 64 });
                }
                if (recipeId === 'b3-recipe' && quantity === 'ALL') {
                    const crafts = Math.floor(counts.b2 / 16);
                    counts.b2 -= crafts * 16;
                    counts.b3 += crafts;
                    return Result.ok({ actualCrafts: crafts });
                }
                throw new Error(`unexpected craft ${recipeId}:${quantity}`);
            }
        },
        personalVault: {
            async deposit(id) { calls.push(`deposit:${id}`); return Result.ok({}); },
            async withdraw() { return Result.ok({}); }
        },
        storage: {},
        b1Materials: {
            async ensureBaseAvailable() { return Result.ok({ ready: true }); },
            async compact(baseId) { calls.push(`maintenance-compact:${baseId}`); return Result.ok({}); },
            async compactAll() { return Result.ok({}); },
            async preprocessForCraft() { calls.push('unexpected-smelt-boundary'); return Result.ok({}); },
            async protectForB5Batch() { calls.push('unexpected-protection-boundary'); return Result.ok({}); }
        },
        inventoryReader: { readBotInventory: () => ({ source: 'bot-inventory', emptySlotCount: Math.max(0, 36 - Math.ceil(counts.b2 / 64) - Math.ceil(counts.b3 / 64)), counts: { ...counts } }) },
        inventoryCounter: { count: (snapshot, id) => Number(snapshot.counts?.[id] || 0) },
        recipeRegistry: { require: () => ({ inputs: {} }) },
        operationManager: operationManager(),
        config: {
            targetId: 'super_alloy', timeoutMs: 1000, inventorySafetyEmptySlots: 2,
            quantityOptimization: { enabled: true, useAllForB2: false, useAllForB3: true, useAllForB4WhenExact: true, useAllForB5: false }
        }
    });

    const result = await service.runNext();
    assert.equal(result.success, true);
    assert.deepEqual(calls.filter(call => call.startsWith('craft:')), [
        'craft:b2-recipe:64',
        'craft:b2-recipe:64',
        'craft:b3-recipe:ALL'
    ]);
    assert.equal(calls.includes('maintenance-compact:coal'), true, 'B3 material chain must maintenance-compress loose B1');
    assert.equal(calls.includes('unexpected-smelt-boundary'), false, 'maintenance compression must not smelt');
    assert.equal(calls.includes('unexpected-protection-boundary'), false, 'maintenance compression must not open a protection/sell episode');
});


test('B1->B2 final shortage below 64 still crafts 64, then B3 ALL, and stores surplus B3', async () => {
    const calls = [];
    const counts = { b2: 0, b3: 0 };
    let inspectCall = 0;
    const chain = {
        baseId: 'coal', b2Id: 'b2', b3Id: 'b3',
        b2RecipeId: 'b2-recipe', b3RecipeId: 'b3-recipe',
        b2OutputAmount: 1, b3InputPerCraft: 16,
        rawNeededFromStorage: 7 * 16, storedEffective: 64 * 16,
        readyToReserve: true, b2Crafts: 7, b3Crafts: 1,
        vaultB2: 0, inventoryB2: 0, inventoryB3: 0
    };
    const planningService = {
        async inspectAdditional() {
            inspectCall += 1;
            return Result.ok({
                personalVault: { totals: { super_alloy: 0 } },
                fullPlan: { targetId: 'super_alloy', feasible: false },
                finalSteps: [],
                chains: inspectCall === 1 ? [chain] : []
            });
        }
    };
    const recipes = {
        'b2-recipe': { output: 'b2', inputs: { coal: 16 } },
        'b3-recipe': { output: 'b3', inputs: { b2: 16 } },
        super_alloy: { output: 'super_alloy', inputs: { x: 1 } }
    };
    const service = new B5AutomationService({
        planningService,
        crafting: {
            async craft(recipeId, quantity) {
                calls.push(`craft:${recipeId}:${quantity}`);
                if (recipeId === 'b2-recipe' && quantity === 64) {
                    counts.b2 += 64;
                    return Result.ok({ actualCrafts: 64 });
                }
                if (recipeId === 'b3-recipe' && quantity === 'ALL') {
                    const crafts = Math.floor(counts.b2 / 16);
                    counts.b2 -= crafts * 16;
                    counts.b3 += crafts;
                    return Result.ok({ actualCrafts: crafts });
                }
                throw new Error(`unexpected craft ${recipeId}:${quantity}`);
            }
        },
        personalVault: {
            async deposit(id) {
                calls.push(`deposit:${id}`);
                if (id === 'b3') counts.b3 = 0;
                if (id === 'b2') counts.b2 = 0;
                return Result.ok({});
            },
            async withdraw() { return Result.ok({}); }
        },
        storage: {},
        b1Materials: {
            async ensureBaseAvailable(_id, required) { calls.push(`ensure:${required}`); return Result.ok({ ready: true }); },
            async compact() { return Result.ok({}); },
            async compactAll() { return Result.ok({}); }
        },
        inventoryReader: { readBotInventory: () => ({ source: 'bot-inventory', emptySlotCount: Math.max(1, 36 - Math.ceil(counts.b2 / 64) - Math.ceil(counts.b3 / 64)), counts: { ...counts } }) },
        inventoryCounter: { count: (snapshot, id) => Number(snapshot.counts?.[id] || 0) },
        recipeRegistry: { require: id => recipes[id] || { output: id, inputs: {} } },
        operationManager: operationManager(),
        config: {
            targetId: 'super_alloy', timeoutMs: 1000, b3AllMinEmptySlots: 1,
            quantityOptimization: { enabled: true, useAllForB2: false, useAllForB3: true, useAllForB4WhenExact: true, useAllForB5: false, b2BatchSize: 64 }
        }
    });

    const result = await service.runNext();
    assert.equal(result.success, true);
    assert.equal(calls.includes('ensure:1024'), true);
    assert.deepEqual(calls.filter(call => call.startsWith('craft:')), [
        'craft:b2-recipe:64',
        'craft:b3-recipe:ALL'
    ]);
    assert.equal(calls.some(call => call === 'craft:b2-recipe:1'), false);
    assert.equal(calls.includes('deposit:b3'), true);
});

test('continuous B1 supply crafts the complete 64 batch available now instead of waiting for the whole B2 shortage', async () => {
    const calls = [];
    const counts = { b2: 0, b3: 0 };
    let inspectCall = 0;
    const chain = {
        baseId: 'coal', b2Id: 'b2', b3Id: 'b3',
        b2RecipeId: 'b2-recipe', b3RecipeId: 'b3-recipe',
        b2OutputAmount: 1, b3InputPerCraft: 16,
        rawNeededFromStorage: 128 * 16, storedEffective: 64 * 16,
        readyToReserve: false, missingRaw: 64 * 16,
        b2Crafts: 128, b3Crafts: 8,
        vaultB2: 0, inventoryB2: 0, inventoryB3: 0
    };
    const planningService = {
        async inspectAdditional() {
            inspectCall += 1;
            return Result.ok({
                personalVault: { totals: { super_alloy: 0 } },
                fullPlan: { targetId: 'super_alloy', feasible: false },
                finalSteps: [],
                chains: inspectCall === 1 ? [chain] : []
            });
        }
    };
    const recipes = {
        'b2-recipe': { output: 'b2', inputs: { coal: 16 } },
        'b3-recipe': { output: 'b3', inputs: { b2: 16 } },
        super_alloy: { output: 'super_alloy', inputs: { x: 1 } }
    };
    const service = new B5AutomationService({
        planningService,
        crafting: {
            async craft(recipeId, quantity) {
                calls.push(`craft:${recipeId}:${quantity}`);
                if (recipeId === 'b2-recipe') { counts.b2 += 64; return Result.ok({ actualCrafts: 64 }); }
                if (recipeId === 'b3-recipe') {
                    const crafts = Math.floor(counts.b2 / 16);
                    counts.b2 -= crafts * 16;
                    counts.b3 += crafts;
                    return Result.ok({ actualCrafts: crafts });
                }
                throw new Error(`unexpected craft ${recipeId}:${quantity}`);
            }
        },
        personalVault: {
            async deposit(id) { calls.push(`deposit:${id}`); if (id === 'b3') counts.b3 = 0; return Result.ok({}); },
            async withdraw() { return Result.ok({}); }
        },
        storage: {},
        b1Materials: {
            async ensureBaseAvailable(_id, required) { calls.push(`ensure:${required}`); return Result.ok({ ready: true }); },
            async compact() { return Result.ok({}); },
            async compactAll() { return Result.ok({}); }
        },
        inventoryReader: { readBotInventory: () => ({ source: 'bot-inventory', emptySlotCount: Math.max(1, 36 - Math.ceil(counts.b2 / 64) - Math.ceil(counts.b3 / 64)), counts: { ...counts } }) },
        inventoryCounter: { count: (snapshot, id) => Number(snapshot.counts?.[id] || 0) },
        recipeRegistry: { require: id => recipes[id] || { output: id, inputs: {} } },
        operationManager: operationManager(),
        config: {
            targetId: 'super_alloy', timeoutMs: 1000, b3AllMinEmptySlots: 1,
            quantityOptimization: { enabled: true, useAllForB2: false, useAllForB3: true, useAllForB4WhenExact: true, useAllForB5: false, b2BatchSize: 64 }
        }
    });

    const result = await service.runNext();
    assert.equal(result.success, true);
    assert.equal(calls.includes('ensure:1024'), true);
    assert.deepEqual(calls.filter(call => call.startsWith('craft:')), [
        'craft:b2-recipe:64',
        'craft:b3-recipe:ALL'
    ]);
});

test('B1->B2 never falls back to quantity 1 while waiting for a complete 64 batch from continuous supply', async () => {
    const calls = [];
    let inspectCall = 0;
    const chain = {
        baseId: 'coal', b2Id: 'b2', b3Id: 'b3',
        b2RecipeId: 'b2-recipe', b3RecipeId: 'b3-recipe',
        b2OutputAmount: 1, b3InputPerCraft: 16,
        rawNeededFromStorage: 7 * 16, storedEffective: 7 * 16,
        readyToReserve: true, b2Crafts: 7, b3Crafts: 1,
        vaultB2: 0, inventoryB2: 0, inventoryB3: 0
    };
    const planningService = {
        async inspectAdditional() {
            inspectCall += 1;
            return Result.ok({
                personalVault: { totals: { super_alloy: 0 } },
                fullPlan: { targetId: 'super_alloy', feasible: false },
                finalSteps: [],
                chains: inspectCall === 1 ? [chain] : []
            });
        }
    };
    const service = new B5AutomationService({
        planningService,
        crafting: { async craft(recipeId, quantity) { calls.push(`craft:${recipeId}:${quantity}`); return Result.ok({ actualCrafts: Number(quantity) || 0 }); } },
        personalVault: { async deposit() { return Result.ok({}); }, async withdraw() { return Result.ok({}); } },
        storage: {},
        b1Materials: {
            async ensureBaseAvailable() { calls.push('ensure'); return Result.ok({ ready: true }); },
            async compactAll() { return Result.ok({}); },
            async compact() { return Result.ok({}); },
            async sellLargestStoredBlock() { return Result.ok({}); }
        },
        inventoryReader: { readBotInventory: () => ({ source: 'bot-inventory', emptySlotCount: 36, counts: {} }) },
        inventoryCounter: { count: () => 0 },
        recipeRegistry: { require: id => id === 'b2-recipe' ? { output: 'b2', inputs: { coal: 16 } } : { output: id, inputs: {} } },
        operationManager: operationManager(),
        config: {
            targetId: 'super_alloy', timeoutMs: 1000, b3AllMinEmptySlots: 1,
            quantityOptimization: { enabled: true, useAllForB2: false, useAllForB3: true, useAllForB4WhenExact: true, useAllForB5: false, b2BatchSize: 64 }
        }
    });

    const result = await service.runNext();
    assert.equal(result.success, true);
    assert.deepEqual(calls.filter(call => call.startsWith('craft:')), []);
    assert.equal(calls.includes('ensure'), false);
    assert.equal(result.data.actions.some(action => action.reason === 'waiting-for-complete-b2-batch'), true);
});

test('final B4 uses ALL only when current inventory can craft exactly remaining amount; B5 stays exact one', async () => {
    const calls = [];
    let inspectCall = 0;
    const counts = { x: 128, y: 256, carbon: 0 };
    const planningService = {
        async inspectAdditional() {
            inspectCall += 1;
            return Result.ok({
                personalVault: { totals: { super_alloy: 0 } },
                fullPlan: { targetId: 'super_alloy', feasible: true },
                chains: [],
                finalSteps: [
                    { recipeId: 'carbon-recipe', outputId: 'carbon', crafts: 32 },
                    { recipeId: 'super-alloy-recipe', outputId: 'super_alloy', crafts: 1 }
                ]
            });
        }
    };
    const recipes = {
        'carbon-recipe': { output: 'carbon', inputs: { x: 4, y: 8 } },
        'super-alloy-recipe': { output: 'super_alloy', inputs: { carbon: 32 } }
    };
    const service = new B5AutomationService({
        planningService,
        crafting: {
            async craft(recipeId, quantity) {
                calls.push(`craft:${recipeId}:${quantity}`);
                if (recipeId === 'carbon-recipe') {
                    counts.x = 0; counts.y = 0; counts.carbon = 32;
                    return Result.ok({ actualCrafts: 32 });
                }
                counts.carbon = 0;
                return Result.ok({ actualCrafts: 1 });
            }
        },
        personalVault: {
            async deposit(id) { calls.push(`deposit:${id}`); return Result.ok({}); },
            async read() { return Result.ok({ totals: { super_alloy: 1 } }); },
            async withdraw() { throw new Error('withdraw should not be needed in this test'); }
        },
        storage: {},
        b1Materials: {
            async ensureBaseAvailable() { return Result.ok({}); }, async compact() { return Result.ok({}); },
            async compactAll() { return Result.ok({}); }, async sellLargestStoredBlock() { return Result.ok({}) }
        },
        inventoryReader: { readBotInventory: () => ({ source: 'bot-inventory', emptySlotCount: 0, counts: { ...counts } }) },
        inventoryCounter: { count: (snapshot, id) => Number(snapshot.counts?.[id] || 0) },
        recipeRegistry: { require: id => recipes[id] },
        operationManager: operationManager(),
        config: {
            targetId: 'super_alloy', timeoutMs: 1000, inventorySafetyEmptySlots: 2,
            quantityOptimization: { enabled: true, useAllForB2: true, useAllForB3: true, useAllForB4WhenExact: true, useAllForB5: false }
        }
    });

    const result = await service.runNext();
    assert.equal(result.success, true);
    assert.deepEqual(calls.filter(call => call.startsWith('craft:')), [
        'craft:carbon-recipe:ALL',
        'craft:super-alloy-recipe:1'
    ]);
});

test('existing B2 in /pv 2 is withdrawn and compressed with ALL before any B1->B2 craft', async () => {
    const calls = [];
    let inspectCall = 0;
    const counts = { b2: 0, b3: 0 };
    const planningService = {
        async inspectAdditional() {
            inspectCall += 1;
            return Result.ok({
                personalVault: { totals: { super_alloy: 0 } },
                fullPlan: { targetId: 'super_alloy', feasible: false },
                finalSteps: [],
                chains: inspectCall === 1 ? [{
                    baseId: 'coal', b2Id: 'b2', b3Id: 'b3',
                    b2RecipeId: 'b2-recipe', b3RecipeId: 'b3-recipe',
                    b2OutputAmount: 1, b3InputPerCraft: 16,
                    rawNeededFromStorage: 0, readyToReserve: true,
                    b2Crafts: 0, b3Crafts: 10,
                    vaultB2: 160
                }] : []
            });
        }
    };
    const service = new B5AutomationService({
        planningService,
        crafting: {
            async craft(recipeId, quantity) {
                calls.push(`craft:${recipeId}:${quantity}`);
                if (recipeId === 'b3-recipe' && quantity === 'ALL') {
                    counts.b2 = 0;
                    counts.b3 += 10;
                    return Result.ok({ actualCrafts: 10 });
                }
                throw new Error('B1->B2 must not run when /pv 2 already supplies enough B2');
            }
        },
        personalVault: {
            async withdraw(id) {
                calls.push(`withdraw:${id}`);
                counts.b2 = 160;
                return Result.ok({ verification: { beforeInventory: 0, afterInventory: 160 } });
            },
            async deposit(id) { calls.push(`deposit:${id}`); return Result.ok({}); }
        },
        storage: {},
        b1Materials: {
            async ensureBaseAvailable() { throw new Error('B1 preparation must not be needed'); },
            async compact() { return Result.ok({}); },
            async compactAll() { return Result.ok({}); }
        },
        inventoryReader: { readBotInventory: () => ({ source: 'bot-inventory', emptySlotCount: Math.max(1, 36 - Math.ceil(counts.b2 / 64) - Math.ceil(counts.b3 / 64)), counts: { ...counts } }) },
        inventoryCounter: { count: (snapshot, id) => Number(snapshot.counts?.[id] || 0) },
        recipeRegistry: { require: () => ({ inputs: {} }) },
        operationManager: operationManager(),
        config: {
            targetId: 'super_alloy', timeoutMs: 1000, inventorySafetyEmptySlots: 2,
            quantityOptimization: { enabled: true, useAllForB2: true, useAllForB3: true, useAllForB4WhenExact: true, useAllForB5: false }
        }
    });

    const result = await service.runNext();
    assert.equal(result.success, true);
    assert.deepEqual(calls.filter(call => call.startsWith('withdraw:') || call.startsWith('craft:')), [
        'withdraw:b2',
        'craft:b3-recipe:ALL'
    ]);
});

test('B3 ALL satisfying target cancels stale remaining B2-64 work', async () => {
    const calls = [];
    let inspectCall = 0;
    const counts = { b2: 0, b3: 0 };
    const planningService = {
        async inspectAdditional() {
            inspectCall += 1;
            return Result.ok({
                personalVault: { totals: { super_alloy: 0 } },
                fullPlan: { targetId: 'super_alloy', feasible: false },
                finalSteps: [],
                chains: inspectCall === 1 ? [{
                    baseId: 'coal', b2Id: 'b2', b3Id: 'b3',
                    b2RecipeId: 'b2-recipe', b3RecipeId: 'b3-recipe',
                    b2OutputAmount: 1, b3InputPerCraft: 16,
                    rawNeededFromStorage: 128, readyToReserve: true,
                    b2Crafts: 128, b3Crafts: 4,
                    vaultB2: 0
                }] : []
            });
        }
    };
    const service = new B5AutomationService({
        planningService,
        crafting: {
            async craft(recipeId, quantity) {
                calls.push(`craft:${recipeId}:${quantity}`);
                if (recipeId === 'b2-recipe' && quantity === 64) {
                    counts.b2 += 64;
                    return Result.ok({ actualCrafts: 64 });
                }
                if (recipeId === 'b3-recipe' && quantity === 'ALL') {
                    const crafts = Math.floor(counts.b2 / 16);
                    counts.b2 -= crafts * 16;
                    counts.b3 += crafts;
                    return Result.ok({ actualCrafts: crafts });
                }
                throw new Error(`unexpected craft ${recipeId}:${quantity}`);
            }
        },
        personalVault: {
            async withdraw() { throw new Error('no vault withdrawal expected'); },
            async deposit(id) { calls.push(`deposit:${id}`); return Result.ok({}); }
        },
        storage: {},
        b1Materials: {
            async ensureBaseAvailable() { return Result.ok({ ready: true }); },
            async compact() { return Result.ok({}); },
            async compactAll() { return Result.ok({}); }
        },
        inventoryReader: { readBotInventory: () => ({ source: 'bot-inventory', emptySlotCount: Math.max(1, 36 - Math.ceil(counts.b2 / 64) - Math.ceil(counts.b3 / 64)), counts: { ...counts } }) },
        inventoryCounter: { count: (snapshot, id) => Number(snapshot.counts?.[id] || 0) },
        recipeRegistry: { require: () => ({ inputs: {} }) },
        operationManager: operationManager(),
        config: {
            targetId: 'super_alloy', timeoutMs: 1000, inventorySafetyEmptySlots: 2,
            quantityOptimization: { enabled: true, useAllForB2: false, useAllForB3: true, useAllForB4WhenExact: true, useAllForB5: false }
        }
    });

    const result = await service.runNext();
    assert.equal(result.success, true);
    assert.deepEqual(calls.filter(call => call.startsWith('craft:')), [
        'craft:b2-recipe:64',
        'craft:b3-recipe:ALL'
    ]);
});

test('B3 target already satisfied by pv2 + inventory is stored and skipped before next material', async () => {
    const calls = [];
    let inspectCall = 0;
    const planningService = {
        async inspectAdditional() {
            inspectCall += 1;
            return Result.ok({
                personalVault: { totals: { super_alloy: 0 } },
                fullPlan: { targetId: 'super_alloy', feasible: false },
                finalSteps: [],
                chains: inspectCall === 1 ? [{
                    baseId: 'diamond', b2Id: 'refined_diamond', b3Id: 'refined_diamond_block',
                    b2RecipeId: 'refined_diamond', b3RecipeId: 'refined_diamond_block',
                    b2OutputAmount: 1, b3InputPerCraft: 16,
                    rawNeededFromStorage: 0, readyToReserve: true,
                    b2Crafts: 0, b3Crafts: 0,
                    vaultB2: 0, inventoryB2: 0,
                    vaultB3: 120, inventoryB3: 8
                }] : []
            });
        }
    };
    const service = new B5AutomationService({
        planningService,
        crafting: { async craft() { throw new Error('craft must be skipped when B3 total is already sufficient'); } },
        personalVault: {
            async deposit(id) { calls.push(`deposit:${id}`); return Result.ok({ movedStacks: 1 }); },
            async withdraw() { throw new Error('withdraw not expected'); }
        },
        storage: {},
        b1Materials: {
            async ensureBaseAvailable() { throw new Error('B1 preparation not expected'); },
            async compact() { return Result.ok({}); },
            async compactAll() { return Result.ok({}); }
        },
        inventoryReader: { readBotInventory: () => ({ source: 'bot-inventory', emptySlotCount: 30, counts: { refined_diamond_block: 8 } }) },
        inventoryCounter: { count: (snapshot, id) => Number(snapshot.counts?.[id] || 0) },
        recipeRegistry: { require: () => ({ inputs: {} }) },
        operationManager: operationManager(),
        config: {
            targetId: 'super_alloy', timeoutMs: 1000, b3AllMinEmptySlots: 1,
            quantityOptimization: { enabled: true, useAllForB2: false, useAllForB3: true, useAllForB4WhenExact: true, useAllForB5: false }
        }
    });

    const result = await service.runNext();
    assert.equal(result.success, true);
    assert.deepEqual(calls, ['deposit:refined_diamond_block']);
});


test('maintenance mode never crafts B5 even when the final plan is already feasible', async () => {
    const calls = [];
    const planningService = {
        async inspectAdditional() {
            return Result.ok({
                personalVault: { totals: { super_alloy: 0 }, emptySlotCount: 20 },
                personalVaultPressure: { allowNewIntermediates: true },
                fullPlan: { targetId: 'super_alloy', feasible: true },
                finalSteps: [{ recipeId: 'super_alloy', outputId: 'super_alloy', crafts: 1 }],
                chains: []
            });
        }
    };
    const service = new B5AutomationService({
        planningService,
        crafting: { async craft() { calls.push('craft'); return Result.ok({ actualCrafts: 1 }); } },
        personalVault: {
            async deposit(id) { calls.push(`deposit:${id}`); return Result.ok({}); },
            async withdraw() { return Result.ok({}); }
        },
        storage: {},
        b1Materials: {
            async compactAll() { calls.push('compact-all'); return Result.ok({}); },
            async sellLargestStoredBlock() { calls.push('sell-largest'); return Result.ok({ sold: false }); }
        },
        inventoryReader: { read: () => ({ emptySlotCount: 36 }) },
        inventoryCounter: { count: () => 0 },
        recipeRegistry: { require: () => ({ output: 'super_alloy', inputs: {} }) },
        operationManager: operationManager(),
        config: { targetId: 'super_alloy', timeoutMs: 1000, inventorySafetyEmptySlots: 2 }
    });

    const result = await service.runMaintenance({ allowNewB2: true });
    assert.equal(result.success, true);
    assert.equal(result.data.completedNewB5, false);
    assert.equal(result.data.b5Ready, false);
    assert.equal(calls.includes('craft'), false);
    assert.equal(calls.includes('deposit:super_alloy'), false);
    assert.equal(calls.includes('compact-all'), true);
});

test('PV2 backpressure suppresses new B1->B2 work during maintenance', async () => {
    const calls = [];
    const chain = {
        baseId: 'coal', b2Id: 'b2', b3Id: 'b3',
        b2RecipeId: 'b2-recipe', b3RecipeId: 'b3-recipe',
        b2OutputAmount: 1, b3InputPerCraft: 16,
        rawNeededFromStorage: 1024, readyToReserve: true,
        b2Crafts: 64, b3Crafts: 4,
        vaultB2: 0, inventoryB2: 0, inventoryB3: 0
    };
    const planningService = {
        async inspectAdditional() {
            return Result.ok({
                personalVault: { totals: {}, emptySlotCount: 1 },
                personalVaultPressure: { allowNewIntermediates: false, backpressure: true, critical: true, emptySlotCount: 1 },
                fullPlan: { targetId: 'super_alloy', feasible: false },
                finalSteps: [],
                chains: [chain]
            });
        }
    };
    const service = new B5AutomationService({
        planningService,
        crafting: { async craft(recipeId, quantity) { calls.push(`craft:${recipeId}:${quantity}`); return Result.ok({ actualCrafts: 1 }); } },
        personalVault: {
            async deposit(id) { calls.push(`deposit:${id}`); return Result.ok({}); },
            async withdraw() { return Result.ok({}); }
        },
        storage: {},
        b1Materials: {
            async ensureBaseAvailable() { calls.push('base-ready'); return Result.ok({ ready: true }); },
            async compactAll() { calls.push('compact-all'); return Result.ok({}); },
            async sellLargestStoredBlock() { return Result.ok({ sold: false }); }
        },
        inventoryReader: { read: () => ({ emptySlotCount: 36 }) },
        inventoryCounter: { count: () => 0 },
        recipeRegistry: { require: () => ({ inputs: {} }) },
        operationManager: operationManager(),
        config: { targetId: 'super_alloy', timeoutMs: 1000, inventorySafetyEmptySlots: 2, b3AllMinEmptySlots: 1 }
    });

    const result = await service.runMaintenance({ allowNewB2: true });
    assert.equal(result.success, true);
    assert.equal(result.data.allowNewB2, false);
    assert.equal(calls.some(call => call.startsWith('craft:b2-recipe')), false);
    assert.equal(calls.includes('base-ready'), false);
    assert.equal(result.data.actions.some(action => action.status === 'new-b2-suppressed' && action.reason === 'pv2-backpressure'), true);
});

test('zero-slot emergency parks the last current B2 stack in PV2 and replans instead of throwing B5_INTERMEDIATE_NO_SPACE', async () => {
    const calls = [];
    const counts = { b2: 64, b3: 0 };
    let inspectCall = 0;
    const planningService = {
        async inspectAdditional() {
            inspectCall += 1;
            return Result.ok({
                personalVault: { totals: { super_alloy: 0, b2: inspectCall > 1 ? 64 : 0 } },
                fullPlan: { targetId: 'super_alloy', feasible: false },
                finalSteps: [],
                chains: inspectCall === 1 ? [{
                    baseId: 'cobblestone', b2Id: 'b2', b3Id: 'b3',
                    b2RecipeId: 'b2-recipe', b3RecipeId: 'b3-recipe',
                    b2OutputAmount: 1, b3InputPerCraft: 16,
                    rawNeededFromStorage: 0, readyToReserve: true,
                    b2Crafts: 0, b3Crafts: 4,
                    vaultB2: 0, inventoryB2: 64, inventoryB3: 0
                }] : []
            });
        }
    };
    const service = new B5AutomationService({
        planningService,
        crafting: {
            async craft(recipeId, quantity) {
                calls.push(`craft:${recipeId}:${quantity}`);
                throw new Error('B3 must not be attempted after parking the only B2 stack');
            }
        },
        personalVault: {
            async deposit(id, options = {}) {
                calls.push(`deposit:${id}:${options.maxStacks || 'all'}`);
                if (id === 'b2' && options.maxStacks === 1 && counts.b2 > 0) {
                    counts.b2 = 0;
                    return Result.ok({ movedStacks: 1 });
                }
                return Result.ok({ movedStacks: 0 });
            },
            async withdraw() { throw new Error('parked B2 must not be immediately withdrawn into the only free slot'); }
        },
        storage: {},
        b1Materials: {
            async ensureBaseAvailable() { return Result.ok({}); },
            async compact() { calls.push('compact-b1'); return Result.ok({}); },
            async compactAll() { return Result.ok({}); }
        },
        inventoryReader: {
            readBotInventory: () => ({
                source: 'bot-inventory',
                // Simulate every other slot being occupied by unrelated/player items.
                // Parking the one B2 stack creates exactly the B3 output slot.
                emptySlotCount: counts.b2 > 0 ? 0 : 1,
                counts: { ...counts }
            })
        },
        inventoryCounter: { count: (snapshot, id) => Number(snapshot.counts?.[id] || 0) },
        recipeRegistry: { require: id => ({ output: id, inputs: {} }) },
        operationManager: operationManager(),
        config: {
            targetId: 'super_alloy', timeoutMs: 1000, b3AllMinEmptySlots: 1,
            quantityOptimization: { enabled: true, useAllForB2: false, useAllForB3: true, useAllForB4WhenExact: true, useAllForB5: false, b2BatchSize: 64 }
        }
    });

    const result = await service.runNext();
    assert.equal(result.success, true);
    assert.equal(calls.includes('deposit:b2:1'), true);
    assert.equal(calls.some(call => call.startsWith('craft:b3-recipe')), false);
    assert.equal(result.data.actions.some(action => action.status === 'post-production-b1-compacted'), false, 'normal production does not compact all loose B1 after a space deferral');
    assert.equal(result.data.actions.some(action => action.status === 'deferred-for-space' || action.status === 'b2-pv2-parked-for-space'), true);
});

test('B1->B2 ALL may fill inventory without a mid-craft storage-pressure sale gate, then parks B2 and runs B2->B3 ALL', async () => {
    const calls = [];
    let inspectCall = 0;
    const counts = { b2: 0, b3: 0 };
    let carried = 0;
    const planningService = {
        async inspectAdditional() {
            inspectCall += 1;
            return Result.ok({
                personalVault: { totals: { super_alloy: 0 } },
                fullPlan: { targetId: 'super_alloy', feasible: false },
                finalSteps: [],
                chains: inspectCall === 1 ? [{
                    baseId: 'coal', b2Id: 'b2', b3Id: 'b3',
                    b2RecipeId: 'b2-recipe', b3RecipeId: 'b3-recipe',
                    b2OutputAmount: 1, b3InputPerCraft: 16,
                    rawNeededFromStorage: 320, storedEffective: 6400,
                    readyToReserve: true, b2Crafts: 20, b3Crafts: 1,
                    vaultB2: 0, inventoryB2: 0, inventoryB3: 0
                }] : [{
                    baseId: 'coal', b2Id: 'b2', b3Id: 'b3',
                    b2RecipeId: 'b2-recipe', b3RecipeId: 'b3-recipe',
                    b2OutputAmount: 1, b3InputPerCraft: 16,
                    rawNeededFromStorage: 0, storedEffective: 0,
                    readyToReserve: true, b2Crafts: 0, b3Crafts: Math.floor(counts.b2 / 16),
                    vaultB2: carried, inventoryB2: counts.b2, inventoryB3: counts.b3
                }]
            });
        }
    };
    const service = new B5AutomationService({
        planningService,
        crafting: {
            async craft(recipeId, quantity, options = {}) {
                calls.push(`craft:${recipeId}:${quantity}`);
                if (recipeId === 'b2-recipe' && quantity === 'ALL') {
                    assert.deepEqual(options.reconciliationBaseline?.inputs?.coal, { source: 'storage', count: 320 });
                    counts.b2 += 160;
                    return Result.ok({ actualCrafts: 160 });
                }
                if (recipeId === 'b3-recipe' && quantity === 'ALL') {
                    const crafts = Math.floor(counts.b2 / 16);
                    counts.b2 -= crafts * 16;
                    counts.b3 += crafts;
                    return Result.ok({ actualCrafts: crafts });
                }
                throw new Error(`unexpected craft ${recipeId}:${quantity}`);
            }
        },
        personalVault: {
            async deposit(id, options = {}) {
                calls.push(`deposit:${id}:${options.maxStacks || 'all'}`);
                if (id === 'b2' && options.maxStacks === 1 && counts.b2 >= 64) {
                    counts.b2 -= 64;
                    carried += 64;
                    return Result.ok({ movedStacks: 1 });
                }
                return Result.ok({ movedStacks: 0 });
            },
            async withdraw(id) {
                calls.push(`withdraw:${id}`);
                if (id === 'b2' && carried >= 64) {
                    carried -= 64;
                    counts.b2 += 64;
                    return Result.ok({ movedStacks: 1 });
                }
                return Result.ok({ movedStacks: 0 });
            }
        },
        storage: {},
        b1Materials: {
            async inspectStoragePressure() { calls.push('storage-guard'); throw new Error('mid-craft storage pressure gate must not run'); },
            async ensureBaseAvailable(_id, required, options = {}) { calls.push(`ensure:${required}`); assert.equal(options.decompressionPolicy, 'unbounded'); return Result.ok({ ready: true, available: 320 }); },
            async compact() { return Result.ok({}); },
            async compactAll() { return Result.ok({}); }
        },
        inventoryReader: {
            readBotInventory: () => ({
                source: 'bot-inventory',
                emptySlotCount: Math.max(0, 3 - Math.ceil(counts.b2 / 64) - Math.ceil(counts.b3 / 64)),
                counts: { ...counts }
            })
        },
        inventoryCounter: { count: (snapshot, id) => Number(snapshot.counts?.[id] || 0) },
        recipeRegistry: { require: id => id === 'b2-recipe' ? { output: 'b2', inputs: { coal: 16 } } : { output: id, inputs: {} } },
        operationManager: operationManager(),
        config: {
            targetId: 'super_alloy', timeoutMs: 1000, b3AllMinEmptySlots: 1,
            quantityOptimization: { enabled: true, useAllForB2: true, useAllForB3: true, useAllForB4WhenExact: true, useAllForB5: false }
        }
    });

    const result = await service.runNext();
    assert.equal(result.success, true);
    assert.equal(calls.includes('storage-guard'), false);
    assert.equal(calls.includes('ensure:16'), true);
    assert.equal(calls.includes('craft:b2-recipe:ALL'), true);
    assert.equal(calls.some(call => call === 'deposit:b2:1'), true);
    assert.equal(calls.includes('withdraw:b2'), true);
    assert.equal(calls.includes('craft:b3-recipe:ALL'), true);
    assert.equal(carried, 0, 'parked B2 may be withdrawn after the fresh re-plan to finish the B3 ALL chain');
    assert.equal(counts.b3, 10);
});

test('transient prepare-b1 NOT_READY is a normal material wait instead of an automation error', async () => {
    let inspections = 0;
    const planningService = {
        async inspectAdditional() {
            inspections += 1;
            return Result.ok({
                personalVault: { totals: { super_alloy: 0 }, emptySlotCount: 20 },
                personalVaultPressure: { allowNewIntermediates: true },
                fullPlan: { targetId: 'super_alloy', feasible: false },
                finalSteps: [],
                chains: [{
                    baseId: 'coal', b2Id: 'b2', b3Id: 'b3',
                    b2RecipeId: 'b2-recipe', b3RecipeId: 'b3-recipe',
                    b2OutputAmount: 1, b3InputPerCraft: 16,
                    rawNeededFromStorage: 16, storedEffective: 16,
                    readyToReserve: true, b2Crafts: 1, b3Crafts: 1,
                    vaultB2: 0, vaultB3: 0, inventoryB2: 0, inventoryB3: 0
                }],
                progress: { remainingStages: 2, remainingCrafts: 2, nextStep: { kind: 'B2/B3', id: 'b3' } }
            });
        }
    };
    let craftCalls = 0;
    const service = new B5AutomationService({
        planningService,
        crafting: { async craft() { craftCalls += 1; return Result.ok({}); } },
        personalVault: {
            async deposit() { return Result.ok({ movedStacks: 0 }); },
            async withdraw() { return Result.ok({ movedStacks: 0 }); },
            async read() { return Result.ok({ totals: { super_alloy: 0 } }); }
        },
        storage: {},
        b1Materials: {
            async inspectStoragePressure() { return Result.ok({ known: true, protectionRequired: false, usageRatio: 0.23 }); },
            async ensureBaseAvailable() { return Result.fail('NOT_READY', 'Not enough effective coal in /kho.', null, { required: 16, effective: 0 }); },
            async compact() { return Result.ok({}); },
            async compactAll() { return Result.ok({}); }
        },
        inventoryReader: { readBotInventory: () => ({ source: 'bot-inventory', emptySlotCount: 36, counts: {} }) },
        inventoryCounter: { count: () => 0 },
        recipeRegistry: {
            require(id) {
                if (id === 'b2-recipe') return { output: 'b2', inputs: { coal: 16 } };
                if (id === 'b3-recipe') return { output: 'b3', inputs: { b2: 16 } };
                return { output: id, inputs: {} };
            }
        },
        operationManager: operationManager(),
        config: {
            targetId: 'super_alloy', timeoutMs: 1000, b3AllMinEmptySlots: 1,
            quantityOptimization: { enabled: true, useAllForB2: true, useAllForB3: true, useAllForB4WhenExact: true, useAllForB5: false }
        }
    });

    const result = await service.runNext();
    assert.equal(result.success, true);
    assert.equal(result.data.completedNewB5, false);
    assert.equal(result.data.waitingForMaterials, true);
    assert.equal(result.data.actions.some(action => action.status === 'waiting' && action.reason === 'b1-not-ready'), true);
    assert.equal(result.data.blockingReasons.some(action => action.reason === 'b1-not-ready'), true);
    assert.equal(result.data.productive, false);
    assert.equal(craftCalls, 0);
    assert.equal(inspections > 0, true);
});

test('new B2 work preserves planner chain order without fast-disposable exceptions', async () => {
    const prepareOrder = [];
    const chains = [
        {
            baseId: 'lapis_lazuli', b2Id: 'lapis_b2', b3Id: 'lapis_b3',
            b2RecipeId: 'lapis-b2-recipe', b3RecipeId: 'lapis-b3-recipe',
            b2OutputAmount: 1, b3InputPerCraft: 16,
            rawNeededFromStorage: 1024, storedEffective: 1024,
            readyToReserve: true, b2Crafts: 64, b3Crafts: 0,
            vaultB2: 0, vaultB3: 0, inventoryB2: 0, inventoryB3: 0
        },
        {
            baseId: 'coal', b2Id: 'coal_b2', b3Id: 'coal_b3',
            b2RecipeId: 'coal-b2-recipe', b3RecipeId: 'coal-b3-recipe',
            b2OutputAmount: 1, b3InputPerCraft: 16,
            rawNeededFromStorage: 1024, storedEffective: 1024,
            readyToReserve: true, b2Crafts: 64, b3Crafts: 0,
            vaultB2: 0, vaultB3: 0, inventoryB2: 0, inventoryB3: 0
        }
    ];
    const planningService = {
        async inspectAdditional() {
            return Result.ok({
                personalVault: { totals: { super_alloy: 0 }, emptySlotCount: 20 },
                personalVaultPressure: { allowNewIntermediates: true },
                fullPlan: { targetId: 'super_alloy', feasible: false },
                finalSteps: [], chains,
                progress: { remainingStages: 2, remainingCrafts: 2 }
            });
        }
    };
    const service = new B5AutomationService({
        planningService,
        crafting: { async craft() { return Result.ok({}); } },
        personalVault: {
            async deposit() { return Result.ok({ movedStacks: 0 }); },
            async withdraw() { return Result.ok({ movedStacks: 0 }); },
            async read() { return Result.ok({ totals: { super_alloy: 0 } }); }
        },
        storage: {},
        b1Materials: {
            async ensureBaseAvailable(baseId) {
                prepareOrder.push(baseId);
                return Result.ok({ ready: false, reason: 'waiting-test-fixture' });
            },
            async compactAll() { return Result.ok({}); }
        },
        inventoryReader: { readBotInventory: () => ({ source: 'bot-inventory', emptySlotCount: 36, counts: {} }) },
        inventoryCounter: { count: () => 0 },
        recipeRegistry: {
            require(id) {
                if (id === 'coal-b2-recipe') return { output: 'coal_b2', inputs: { coal: 16 } };
                if (id === 'lapis-b2-recipe') return { output: 'lapis_b2', inputs: { lapis_lazuli: 16 } };
                return { output: id, inputs: {} };
            }
        },
        operationManager: operationManager(),
        config: {
            targetId: 'super_alloy', timeoutMs: 1000,
            quantityOptimization: { enabled: true, useAllForB2: false, useAllForB3: true, useAllForB4WhenExact: true, useAllForB5: false }
        }
    });

    const result = await service.runNext();
    assert.equal(result.success, true);
    assert.deepEqual(prepareOrder, ['lapis_lazuli', 'coal']);
});

test('existing B5 in inventory is recovered to PV2 before any new craft', async () => {
    const calls = [];
    let inventoryTarget = 1;
    const planningService = {
        async inspectAdditional() {
            return Result.ok({
                personalVault: { totals: { super_alloy: 4 }, emptySlotCount: 1, items: [] },
                personalVaultPressure: { allowNewIntermediates: true },
                inventoryTotals: inventoryTarget > 0 ? { super_alloy: inventoryTarget } : {},
                fullPlan: { targetId: 'super_alloy', feasible: true },
                finalSteps: [{ recipeId: 'super_alloy', outputId: 'super_alloy', crafts: 1 }],
                chains: [],
                progress: {}
            });
        }
    };
    const service = new B5AutomationService({
        planningService,
        crafting: { async craft() { calls.push('craft'); return Result.ok({ actualCrafts: 1 }); } },
        personalVault: {
            async deposit(id) { calls.push(`deposit:${id}`); inventoryTarget = 0; return Result.ok({ movedStacks: 1 }); },
            async read() { calls.push('pv-read'); return Result.ok({ totals: { super_alloy: 5 } }); },
            async withdraw() { return Result.ok({}); }
        },
        storage: {},
        b1Materials: { async compactAll() { calls.push('compact-all'); return Result.ok({}); } },
        inventoryReader: { readBotInventory: () => ({ source: 'bot-inventory', emptySlotCount: 35, counts: { super_alloy: inventoryTarget } }) },
        inventoryCounter: { count: (snapshot, id) => Number(snapshot.counts?.[id] || 0) },
        recipeRegistry: { require: () => ({ output: 'super_alloy', inputs: {} }) },
        operationManager: operationManager(),
        config: { targetId: 'super_alloy', timeoutMs: 1000, pvInventorySettleTimeoutMs: 20, pvInventorySettlePollMs: 1 }
    });

    const result = await service.runNext();
    assert.equal(result.success, true);
    assert.equal(result.data.recoveredExistingB5, true);
    assert.equal(result.data.completedNewB5, false);
    assert.deepEqual(calls, ['deposit:super_alloy', 'pv-read']);
});

test('known-full PV2 blocks the final B5 craft when no target stack has capacity', async () => {
    const calls = [];
    const inspection = () => Result.ok({
        personalVault: {
            totals: { other: 64 },
            emptySlotCount: 0,
            items: [{ logicalId: 'other', count: 64, maxStackSize: 64 }]
        },
        personalVaultPressure: { allowNewIntermediates: false, critical: true },
        inventoryTotals: {},
        nonStorageAvailable: {},
        fullPlan: { targetId: 'super_alloy', feasible: true },
        finalSteps: [{ recipeId: 'super_alloy', outputId: 'super_alloy', crafts: 1 }],
        chains: [],
        progress: {}
    });
    const service = new B5AutomationService({
        planningService: { async inspectAdditional() { return inspection(); } },
        crafting: { async craft() { calls.push('craft'); return Result.ok({ actualCrafts: 1 }); } },
        personalVault: {
            async deposit(id) { calls.push(`deposit:${id}`); return Result.ok({}); },
            async read() { return Result.ok({ totals: {} }); },
            async withdraw() { return Result.ok({}); }
        },
        storage: {},
        b1Materials: {
            async compactAll() { calls.push('compact-all'); return Result.ok({}); },
            async sellLargestStoredBlock() { return Result.ok({}); }
        },
        inventoryReader: { read: () => ({ emptySlotCount: 36 }) },
        inventoryCounter: { count: () => 0 },
        recipeRegistry: { require: () => ({ output: 'super_alloy', inputs: {} }) },
        operationManager: operationManager(),
        config: { targetId: 'super_alloy', timeoutMs: 1000 }
    });

    const result = await service.runNext();
    assert.equal(result.success, true);
    assert.equal(result.data.completedNewB5, false);
    assert.equal(result.data.waitingForMaterials, true);
    assert.equal(result.data.actions.some(action => action.reason === 'pv2-target-capacity'), true);
    assert.equal(result.data.blockingReasons.some(action => action.reason === 'pv2-target-capacity'), true);
    assert.equal(calls.includes('craft'), false);
    assert.equal(calls.some(call => call.startsWith('deposit:')), false);
});

test('B4 surplus sharing follows per-B5 ratios instead of draining the first recipe', async () => {
    const owned = { a: 0, b: 0, c: 0 };
    let shared = 12;
    const craftOrder = [];
    const recipes = {
        a: { output: 'a', inputs: { shared: 1 } },
        b: { output: 'b', inputs: { shared: 1 } },
        c: { output: 'c', inputs: { unavailable: 1 } },
        target: { output: 'target', inputs: { a: 1, b: 2, c: 1 } }
    };
    const planningService = {
        async inspectAdditional() {
            return Result.ok({
                personalVault: { totals: { ...owned }, emptySlotCount: 20, items: [] },
                personalVaultPressure: { allowNewIntermediates: true },
                inventoryTotals: {},
                nonStorageAvailable: { ...owned, shared, unavailable: 0 },
                fullPlan: { targetId: 'target', feasible: false },
                finalSteps: [],
                chains: [],
                progress: {}
            });
        }
    };
    const service = new B5AutomationService({
        planningService,
        crafting: {
            async craft(recipeId) {
                assert.equal(shared > 0, true);
                shared -= 1;
                owned[recipeId] += 1;
                craftOrder.push(recipeId);
                return Result.ok({ actualCrafts: 1 });
            }
        },
        personalVault: {
            async deposit() { return Result.ok({ movedStacks: 1 }); },
            async withdraw() { return Result.ok({ movedStacks: 0 }); },
            async read() { return Result.ok({ totals: { ...owned } }); }
        },
        storage: {},
        b1Materials: {
            async compactAll() { return Result.ok({}); }
        },
        inventoryReader: {
            readBotInventory: () => ({ source: 'bot-inventory', emptySlotCount: 35, counts: { shared } })
        },
        inventoryCounter: { count: (snapshot, id) => Number(snapshot.counts?.[id] || 0) },
        recipeRegistry: {
            ids: () => Object.keys(recipes),
            require: id => recipes[id]
        },
        operationManager: operationManager(),
        config: {
            targetId: 'target', timeoutMs: 1000,
            quantityOptimization: { enabled: true, useAllForB4WhenExact: false }
        }
    });

    const result = await service.runMaintenance();
    assert.equal(result.success, true);
    assert.deepEqual(craftOrder.slice(0, 6), ['a', 'b', 'b', 'b', 'b', 'a']);
    assert.equal(owned.b / 2 >= owned.a - 1, true);
    assert.equal(owned.b / 2 <= owned.a + 1, true);
});


test('runNext freshInspection uses planningService.inspectAdditionalFresh inside the managed craft operation', async () => {
    let normalReads = 0;
    let freshReads = 0;
    const inspection = () => Result.ok({
        personalVault: { totals: { super_alloy: 0 }, emptySlotCount: 36, slotCount: 54 },
        personalVaultPressure: { allowNewIntermediates: true, critical: false },
        inventoryTotals: {},
        nonStorageAvailable: { tungsten: 8, titanium: 16, carbon: 32 },
        fullPlan: { targetId: 'super_alloy', feasible: true },
        finalSteps: [{ recipeId: 'super_alloy', outputId: 'super_alloy', crafts: 1 }],
        chains: [],
        progress: {}
    });
    const service = new B5AutomationService({
        planningService: {
            async inspectAdditional() { normalReads += 1; return inspection(); },
            async inspectAdditionalFresh() { freshReads += 1; return inspection(); }
        },
        crafting: { async craft() { return Result.ok({ actualCrafts: 1 }); } },
        personalVault: {
            async deposit() { return Result.ok({}); },
            async read() { return Result.ok({ totals: { super_alloy: 1 }, emptySlotCount: 35, slotCount: 54 }); },
            async withdraw() { return Result.ok({}); }
        },
        storage: {},
        b1Materials: {
            async compactAll() { return Result.ok({}); },
            async sellLargestStoredBlock() { return Result.ok({ sold: false }); }
        },
        inventoryReader: { read: () => ({ emptySlotCount: 36 }) },
        inventoryCounter: { count: (_snapshot, id) => ({ tungsten: 8, titanium: 16, carbon: 32 }[id] || 0) },
        recipeRegistry: {
            require(id) {
                if (id === 'super_alloy') return { output: 'super_alloy', inputs: { tungsten: 8, titanium: 16, carbon: 32 } };
                return { output: id, inputs: {} };
            }
        },
        operationManager: operationManager(),
        config: { targetId: 'super_alloy', timeoutMs: 1000 }
    });

    const result = await service.runNext({ freshInspection: true });
    assert.equal(result.success, true);
    assert.equal(result.data.completedNewB5, true);
    assert.equal(normalReads, 0);
    assert.ok(freshReads >= 2);
    assert.equal(result.data.productive, true);
});

test('B5 automation preserves uncertain-craft reconciliation metadata through managed step wrappers', async () => {
    const manager = new OperationManager({
        botId: 'bot-01',
        queue: new OperationQueue({ maxPending: 8 }),
        lockPolicy: new OperationLockPolicy(),
        timeoutPolicy: new OperationTimeoutPolicy(),
        config: { defaultQueueWaitTimeoutMs: 50, defaultExecutionTimeoutMs: 500, shutdownDrainTimeoutMs: 100 }
    });
    const leaf = new FlowError('uncertain craft', {
        code: 'CRAFTING_OUTCOME_UNCERTAIN',
        retryable: false,
        subsystem: 'crafting', operation: 'CraftingOperation', step: 'verify-output', action: 'reconcile quantity 1', resource: 'super_alloy',
        details: {
            recipeId: 'super_alloy',
            outputId: 'super_alloy',
            amount: 1,
            expectedDelta: 1,
            reconciliationBaseline: { outputCountBefore: 0, inputCountsBefore: { tungsten: 8 } },
            inputEvidence: [{ inputId: 'tungsten', expected: 8 }],
            outcome: { state: 'UNCERTAIN', requiresReconciliation: true, safeToBlindRetry: false, observedSideEffect: false }
        }
    });
    const planningService = {
        async inspectAdditional() {
            return Result.ok({
                personalVault: { totals: { super_alloy: 4 } },
                fullPlan: { targetId: 'super_alloy', feasible: true },
                finalSteps: [{ recipeId: 'super_alloy', crafts: 1, outputId: 'super_alloy' }],
                chains: []
            });
        }
    };
    const service = new B5AutomationService({
        planningService,
        crafting: { async craft() { return Result.fail('VERIFICATION_FAILED', leaf.message, leaf, leaf.details); } },
        personalVault: { async deposit() { throw new Error('must not deposit after uncertain craft'); }, async read() { return Result.ok({ totals: {} }); }, async withdraw() { return Result.ok({}); } },
        storage: {},
        b1Materials: { async compactAll() { return Result.ok({}); }, async sellLargestStoredBlock() { return Result.ok({}); }, async ensureBaseAvailable() { return Result.ok({}); }, async compact() { return Result.ok({}); } },
        inventoryReader: { read: () => ({ emptySlotCount: 36 }) },
        inventoryCounter: { count: () => 0 },
        recipeRegistry: { require: () => ({ output: 'super_alloy', inputs: {} }) },
        operationManager: manager,
        context: { getGeneration: () => 1 },
        config: { timeoutMs: 500, inventorySafetyEmptySlots: 2 }
    });

    const result = await service.runNext({ expectedGeneration: 1 });
    assert.equal(result.success, false);
    assert.equal(result.status, 'VERIFICATION_FAILED');
    assert.equal(result.error.code, 'CRAFTING_OUTCOME_UNCERTAIN');
    assert.equal(result.error.retryable, false);
    assert.equal(result.error.details.outcome.requiresReconciliation, true);
    assert.equal(result.error.details.outcome.safeToBlindRetry, false);
    assert.equal(result.error.details.reconciliationBaseline.inputCountsBefore.tungsten, 8);
    assert.deepEqual(result.error.details.b5CompletionContext, {
        finalChain: true,
        targetId: 'super_alloy',
        targetVaultBefore: 4
    });
    assert.ok(Array.isArray(result.error.details.parentFlow));
    assert.ok(result.error.details.parentFlow.some(entry => entry.step === 'craft-final-chain'));
    await manager.stop();
});


test('B5 recoveryOnly run never promotes or crafts when the proven B5 is no longer in inventory', async () => {
    let craftCalls = 0;
    let compactCalls = 0;
    const inspection = () => Result.ok({
        personalVault: { totals: { super_alloy: 10 }, emptySlotCount: 36, slotCount: 54 },
        personalVaultPressure: { allowNewIntermediates: true, critical: false },
        inventoryTotals: {},
        fullPlan: { targetId: 'super_alloy', feasible: true },
        finalSteps: [{ recipeId: 'super_alloy', outputId: 'super_alloy', crafts: 1 }],
        chains: [],
        progress: {}
    });
    const service = new B5AutomationService({
        planningService: {
            async inspectAdditional() { return inspection(); },
            async inspectAdditionalFresh() { return inspection(); }
        },
        crafting: { async craft() { craftCalls += 1; return Result.ok({ actualCrafts: 1 }); } },
        personalVault: {
            async deposit() { return Result.ok({}); },
            async read() { return Result.ok({ totals: { super_alloy: 10 } }); },
            async withdraw() { return Result.ok({}); }
        },
        storage: {},
        b1Materials: {
            async compactAll() { compactCalls += 1; return Result.ok({}); },
            async sellLargestStoredBlock() { return Result.ok({}); },
            async ensureBaseAvailable() { return Result.ok({}); },
            async compact() { return Result.ok({}); }
        },
        inventoryReader: { read: () => ({ emptySlotCount: 36 }) },
        inventoryCounter: { count: () => 0 },
        recipeRegistry: { require(id) { return { output: id, inputs: {} }; } },
        operationManager: operationManager(),
        config: { targetId: 'super_alloy', timeoutMs: 500, inventorySafetyEmptySlots: 2 }
    });

    const result = await service.runNext({ freshInspection: true, recoveryOnly: true });
    assert.equal(result.success, true);
    assert.equal(result.data.recoveryOnly, true);
    assert.equal(result.data.recoveredExistingB5, false);
    assert.equal(craftCalls, 0);
    assert.equal(compactCalls, 0);
});
