'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Result = require('../../../src/shared/result/Result');
const B5AutomationService = require('../../../src/server-features/crafting/B5AutomationService');

function operationManager() {
    return {
        async run(operation) {
            const token = { throwIfCancelled() {} };
            const data = await operation.executor({ cancellation: { token } });
            return Result.ok(data);
        }
    };
}

test('completed B5 deposits to /pv 2 before compacting B1 and selling only the largest stock', async () => {
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
        'compact-all',
        'sell-largest'
    ]);
});

test('partial reserve cycle compacts all B1 before returning to Collector without blind selling', async () => {
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
        config: { timeoutMs: 1000, inventorySafetyEmptySlots: 2 }
    });

    const result = await service.runNext();
    assert.equal(result.success, true);
    assert.equal(result.data.completedNewB5, false);
    assert.equal(calls.includes('compact-coal'), true);
    assert.equal(calls.includes('compact-all'), true);
    assert.equal(calls.includes('sell-largest'), false);
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
            async compactAll() { return Result.ok({}); },
            async sellLargestStoredBlock() { return Result.ok({}); }
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
            async compact() { return Result.ok({}); },
            async compactAll() { return Result.ok({}); },
            async sellLargestStoredBlock() { return Result.ok({}); }
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
            async compactAll() { return Result.ok({}); },
            async sellLargestStoredBlock() { return Result.ok({}); }
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
            async compactAll() { return Result.ok({}); },
            async sellLargestStoredBlock() { return Result.ok({}); }
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
            async compactAll() { return Result.ok({}); },
            async sellLargestStoredBlock() { return Result.ok({}); }
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
            async compactAll() { return Result.ok({}); },
            async sellLargestStoredBlock() { return Result.ok({}); }
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
            async compactAll() { return Result.ok({}); },
            async sellLargestStoredBlock() { return Result.ok({}); }
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
        personalVault: { async deposit(id) { calls.push(`deposit:${id}`); return Result.ok({}); } },
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
        personalVault: { async deposit(id) { calls.push(`deposit:${id}`); return Result.ok({}); } },
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
            async compactAll() { return Result.ok({}); },
            async sellLargestStoredBlock() { return Result.ok({}); }
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
    assert.equal(result.data.actions.some(action => action.status === 'post-production-b1-compacted'), true);
    assert.equal(result.data.actions.some(action => action.status === 'deferred-for-space' || action.status === 'b2-pv2-parked-for-space'), true);
});

test('guarded B1->B2 ALL may fill inventory, then parks one B2 stack and runs B2->B3 ALL', async () => {
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
                }] : []
            });
        }
    };
    const service = new B5AutomationService({
        planningService,
        crafting: {
            async craft(recipeId, quantity) {
                calls.push(`craft:${recipeId}:${quantity}`);
                if (recipeId === 'b2-recipe' && quantity === 'ALL') {
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
            async withdraw() { return Result.ok({ movedStacks: 0 }); }
        },
        storage: {},
        b1Materials: {
            async inspectStoragePressure() { calls.push('storage-guard'); return Result.ok({ known: true, protectionRequired: false, usageRatio: 0.5 }); },
            async ensureBaseAvailable(_id, required) { calls.push(`ensure:${required}`); return Result.ok({ ready: true }); },
            async compact() { return Result.ok({}); },
            async compactAll() { return Result.ok({}); },
            async sellLargestStoredBlock() { return Result.ok({}); }
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
    assert.equal(calls.includes('storage-guard'), true);
    assert.equal(calls.includes('ensure:16'), true);
    assert.equal(calls.includes('craft:b2-recipe:ALL'), true);
    assert.equal(calls.some(call => call === 'deposit:b2:1'), true);
    assert.equal(calls.includes('craft:b3-recipe:ALL'), true);
    assert.equal(carried, 64);
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
            async compactAll() { return Result.ok({}); },
            async sellLargestStoredBlock() { return Result.ok({}); }
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
    assert.equal(craftCalls, 0);
    assert.equal(inspections > 0, true);
});
