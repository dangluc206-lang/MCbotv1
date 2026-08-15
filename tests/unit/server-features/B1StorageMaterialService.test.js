'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const B1StorageMaterialService = require('../../../src/server-features/storage/B1StorageMaterialService');

function config() {
    return {
        smeltingRecipeIds: ['raw_iron_to_iron'],
        resources: {
            cobblestone: { baseId: 'cobblestone', blockId: null, ratio: 1, sellId: 'cobblestone' },
            coal: { baseId: 'coal', blockId: 'coal_block', ratio: 9, sellId: 'coal_block' },
            diamond: { baseId: 'diamond', blockId: 'diamond_block', ratio: 9, sellId: 'diamond_block' }
        }
    };
}

function snapshot(items) {
    return { success: true, data: { items: { ...items } } };
}

test('effectiveItems expands block stock into B1-equivalent units', () => {
    const service = new B1StorageMaterialService({
        storage: {}, minerals: {}, smelting: {}, conversionConfig: config(),
        smeltingConfig: { recipes: { raw_iron_to_iron: { input: 'raw_iron', output: 'iron_ingot' } } }
    });
    const items = service.effectiveItems({ coal: 3, coal_block: 10, diamond_block: 2 });
    assert.equal(items.coal, 93);
    assert.equal(items.diamond, 18);
});

test('ensureBaseAvailable converts block to base only when loose B1 is insufficient', async () => {
    const reads = [snapshot({ coal: 2, coal_block: 20 }), snapshot({ coal: 182, coal_block: 0 })];
    let converted = 0;
    const service = new B1StorageMaterialService({
        storage: { async read() { return reads.shift(); } },
        minerals: { async toBase(id) { assert.equal(id, 'coal'); converted += 1; return { success: true, data: {} }; } },
        smelting: {}, conversionConfig: config(),
        smeltingConfig: { recipes: { raw_iron_to_iron: { input: 'raw_iron', output: 'iron_ingot' } } }
    });
    const result = await service.ensureBaseAvailable('coal', 64);
    assert.equal(result.success, true);
    assert.equal(result.data.converted, true);
    assert.equal(converted, 1);
});

test('sellLargestStoredBlock sells only the largest compacted logical stock', async () => {
    let soldId = null;
    const service = new B1StorageMaterialService({
        storage: {
            async read() { return snapshot({ cobblestone: 200, coal_block: 800, diamond_block: 20 }); },
            async sell(id, options = {}) { soldId = id; return { success: true, data: { sold: 800 } }; }
        },
        minerals: {}, smelting: {}, conversionConfig: config(),
        smeltingConfig: { recipes: { raw_iron_to_iron: { input: 'raw_iron', output: 'iron_ingot' } } }
    });
    const result = await service.sellLargestStoredBlock();
    assert.equal(result.success, true);
    assert.equal(soldId, 'coal_block');
    assert.equal(result.data.selected.logicalId, 'coal_block');
});

test('preprocess skips unavailable smelting option instead of failing the B5 loop', async () => {
    let smeltCalls = 0;
    const service = new B1StorageMaterialService({
        storage: { async read() { return snapshot({ raw_iron: 128, iron_ingot: 5 }); } },
        minerals: {},
        smelting: {
            async smelt(id) {
                assert.equal(id, 'raw_iron_to_iron');
                smeltCalls += 1;
                return { success: true, data: { skipped: true, reason: 'option-unavailable' } };
            }
        },
        conversionConfig: config(),
        smeltingConfig: { recipes: { raw_iron_to_iron: { input: 'raw_iron', output: 'iron_ingot' } } }
    });

    const result = await service.preprocessForCraft();
    assert.equal(result.success, true);
    assert.equal(smeltCalls, 1);
    assert.equal(result.data.actions[0].skipped, true);
    assert.equal(result.data.actions[0].reason, 'option-unavailable');
});

test('unavailable block to base conversion is treated as waiting, not an error', async () => {
    const service = new B1StorageMaterialService({
        storage: { async read() { return snapshot({ coal: 2, coal_block: 20 }); } },
        minerals: {
            isAvailable() { return true; },
            async toBase() { return { success: true, data: { skipped: true, reason: 'option-unavailable' } }; }
        },
        smelting: {},
        conversionConfig: config(),
        smeltingConfig: { recipes: { raw_iron_to_iron: { input: 'raw_iron', output: 'iron_ingot' } } }
    });

    const result = await service.ensureBaseAvailable('coal', 64);
    assert.equal(result.success, true);
    assert.equal(result.data.ready, false);
    assert.equal(result.data.reason, 'option-unavailable');
    assert.equal(result.data.available, 2);
});

test('effectiveItems stops expanding blocks after toBase capability is known unavailable', () => {
    const service = new B1StorageMaterialService({
        storage: {},
        minerals: { isAvailable(baseId, direction) { return !(baseId === 'coal' && direction === 'toBase'); } },
        smelting: {},
        conversionConfig: config(),
        smeltingConfig: { recipes: { raw_iron_to_iron: { input: 'raw_iron', output: 'iron_ingot' } } }
    });

    const items = service.effectiveItems({ coal: 3, coal_block: 10, diamond_block: 2 });
    assert.equal(items.coal, 3);
    assert.equal(items.diamond, 18);
});

test('compact skips unavailable base to block conversion without failing cleanup', async () => {
    const service = new B1StorageMaterialService({
        storage: { async read() { return snapshot({ coal: 64, coal_block: 0 }); } },
        minerals: { async toBlocks() { return { success: true, data: { skipped: true, reason: 'option-unavailable' } }; } },
        smelting: {},
        conversionConfig: config(),
        smeltingConfig: { recipes: { raw_iron_to_iron: { input: 'raw_iron', output: 'iron_ingot' } } }
    });

    const result = await service.compact('coal');
    assert.equal(result.success, true);
    assert.equal(result.data.converted, false);
    assert.equal(result.data.reason, 'option-unavailable');
});


test('smelting verification polls fresh /kho until telemetry reflects the completed smelt', async () => {
    const reads = [
        snapshot({ raw_iron: 128, iron_ingot: 5 }),
        snapshot({ raw_iron: 128, iron_ingot: 5 }),
        snapshot({ raw_iron: 128, iron_ingot: 5 }),
        snapshot({ raw_iron: 0, iron_ingot: 133 })
    ];
    const refreshFlags = [];
    const service = new B1StorageMaterialService({
        storage: {
            async read(options = {}) {
                refreshFlags.push(Boolean(options.refresh));
                return reads.shift() || snapshot({ raw_iron: 0, iron_ingot: 133 });
            }
        },
        minerals: {},
        smelting: {
            async smelt() { return { success: true, data: { skipped: false } }; }
        },
        conversionConfig: config(),
        smeltingConfig: {
            verificationAttempts: 5,
            verificationRetryMs: 1,
            recipes: { raw_iron_to_iron: { input: 'raw_iron', output: 'iron_ingot' } }
        }
    });

    const result = await service.preprocessForCraft();
    assert.equal(result.success, true);
    assert.equal(result.data.actions[0].afterInput, 0);
    assert.equal(result.data.actions[0].afterOutput, 133);
    assert.equal(result.data.actions[0].verificationAttempt, 3);
    assert.deepEqual(refreshFlags, [false, true, true, true]);
});


test('storage pressure exposes NORMAL/RISING/HIGH/CRITICAL thresholds for continuous supply protection', async () => {
    const conversion = config();
    conversion.storagePressure = {
        watchRatio: 0.75,
        highRatio: 0.85,
        usedRatio: 0.90,
        criticalRatio: 0.95,
        growthHorizonMinutes: 1,
        fastGrowthPerMinute: 0.05,
        maxSalesPerPass: 3
    };
    const ratios = [0.50, 0.80, 0.86, 0.96];
    const service = new B1StorageMaterialService({
        storage: {
            async read() {
                const usageRatio = ratios.shift();
                return { success: true, data: { items: {}, capacity: { usageRatio, used: usageRatio * 1000, limit: 1000 } } };
            }
        },
        minerals: {}, smelting: {}, conversionConfig: conversion,
        smeltingConfig: { recipes: { raw_iron_to_iron: { input: 'raw_iron', output: 'iron_ingot' } } }
    });

    const levels = [];
    for (let i = 0; i < 4; i += 1) levels.push((await service.inspectStoragePressure()).data);
    assert.deepEqual(levels.map(item => item.level), ['NORMAL', 'RISING', 'HIGH', 'CRITICAL']);
    assert.equal(levels[2].shouldConsumeB1, true);
    assert.equal(levels[2].sellRequired, true);
    assert.equal(levels[3].sellRequired, true);
    assert.equal(levels[3].critical, true);
});

test('relieveStoragePressure sells in coarse bursts and re-reads /kho between bursts', async () => {
    const conversion = config();
    conversion.storagePressure = { watchRatio: 0.75, highRatio: 0.85, usedRatio: 0.90, criticalRatio: 0.95, maxSalesPerPass: 3 };
    let reads = 0;
    const sold = [];
    const snapshots = [
        { usageRatio: 0.96, items: { coal_block: 800, diamond_block: 300 } },
        { usageRatio: 0.91, items: { coal_block: 0, diamond_block: 300 } },
        { usageRatio: 0.70, items: { coal_block: 0, diamond_block: 0 } }
    ];
    const service = new B1StorageMaterialService({
        storage: {
            async read() {
                reads += 1;
                const next = snapshots.shift() || { usageRatio: 0.70, items: {} };
                return { success: true, data: { items: next.items, capacity: { usageRatio: next.usageRatio, used: next.usageRatio * 1000, limit: 1000 } } };
            },
            async sell(id, options = {}) { sold.push(id); return { success: true, data: { id } }; }
        },
        minerals: {}, smelting: {}, conversionConfig: conversion,
        smeltingConfig: { recipes: { raw_iron_to_iron: { input: 'raw_iron', output: 'iron_ingot' } } }
    });

    const result = await service.relieveStoragePressure();
    assert.equal(result.success, true);
    assert.deepEqual(sold, ['coal_block', 'coal_block', 'coal_block', 'diamond_block', 'diamond_block', 'diamond_block']);
    assert.equal(reads, 3, 'full /kho should be read once per burst checkpoint, not once per click');
    assert.equal(result.data.reason, 'low-water-reached');
    assert.equal(result.data.pressure.nearFull, false);
});


test('craftableItems excludes block stock when decompression would cross the safe /kho ceiling', () => {
    const conversion = config();
    conversion.storagePressure = { highRatio: 0.85, decompressionMaxRatio: 0.85, requireKnownCapacityForDecompression: true };
    const service = new B1StorageMaterialService({
        storage: {},
        minerals: { isAvailable() { return true; } },
        smelting: {}, conversionConfig: conversion,
        smeltingConfig: { recipes: { raw_iron_to_iron: { input: 'raw_iron', output: 'iron_ingot' } } }
    });

    const safe = service.craftableItems({
        items: { coal: 2, coal_block: 10 },
        capacity: { used: 500, limit: 1000, usageRatio: 0.5 }
    });
    assert.equal(safe.coal, 92);

    const blocked = service.craftableItems({
        items: { coal: 2, coal_block: 50 },
        capacity: { used: 500, limit: 1000, usageRatio: 0.5 }
    });
    assert.equal(blocked.coal, 2);
});

test('ensureBaseAvailable refuses an all-block decompression that could overflow /kho', async () => {
    const conversion = config();
    conversion.storagePressure = { highRatio: 0.85, decompressionMaxRatio: 0.85, requireKnownCapacityForDecompression: true };
    let toBaseCalls = 0;
    const service = new B1StorageMaterialService({
        storage: {
            async read() {
                return {
                    success: true,
                    data: {
                        items: { coal: 2, coal_block: 50 },
                        capacity: { used: 500, limit: 1000, usageRatio: 0.5 }
                    }
                };
            }
        },
        minerals: {
            async toBase() { toBaseCalls += 1; return { success: true, data: {} }; }
        },
        smelting: {}, conversionConfig: conversion,
        smeltingConfig: { recipes: { raw_iron_to_iron: { input: 'raw_iron', output: 'iron_ingot' } } }
    });

    const result = await service.ensureBaseAvailable('coal', 64);
    assert.equal(result.success, true);
    assert.equal(result.data.ready, false);
    assert.equal(result.data.reason, 'unsafe-block-expansion');
    assert.equal(result.data.expansion.projectedRatio > 0.85, true);
    assert.equal(toBaseCalls, 0);
});

test('stabilizeStorage sells high-water stock before attempting GUI compaction', async () => {
    const conversion = config();
    conversion.storagePressure = { watchRatio: 0.75, highRatio: 0.85, usedRatio: 0.90, criticalRatio: 0.95, maxSalesPerPass: 2 };
    const calls = [];
    const reads = [
        snapshot({ coal: 64, coal_block: 0 }),
        snapshot({ coal: 0, coal_block: 7 }),
        { success: true, data: { items: { coal_block: 700 }, capacity: { usageRatio: 0.96, used: 960, limit: 1000 } } },
        { success: true, data: { items: { coal_block: 700 }, capacity: { usageRatio: 0.96, used: 960, limit: 1000 } } },
        { success: true, data: { items: {}, capacity: { usageRatio: 0.70, used: 700, limit: 1000 } } }
    ];
    const service = new B1StorageMaterialService({
        storage: {
            async read() { return reads.shift() || { success: true, data: { items: {}, capacity: { usageRatio: 0.70, used: 700, limit: 1000 } } }; },
            async sell(id, options = {}) { calls.push(`sell:${id}`); return { success: true, data: { id } }; }
        },
        minerals: {
            async toBlocks(id) { calls.push(`block:${id}`); return { success: true, data: {} }; }
        },
        smelting: {}, conversionConfig: conversion,
        smeltingConfig: { recipes: { raw_iron_to_iron: { input: 'raw_iron', output: 'iron_ingot' } } }
    });

    // Limit this fixture to one resource so compactAll does not consume reads
    // for unrelated resources.
    service.resources = Object.freeze({ coal: service.resources.coal });
    const result = await service.stabilizeStorage();
    assert.equal(result.success, true);
    assert.equal(calls[0], 'sell:coal_block');
    assert.equal(calls.every(call => call.startsWith('sell:')), true, 'pressure sale must happen before any GUI compaction');
    assert.equal(result.data.pressure.nearFull, false);
});


test('fast continuous growth can trigger proactive selling before current usage reaches 90%', async () => {
    const conversion = config();
    conversion.storagePressure = {
        watchRatio: 0.75,
        highRatio: 0.85,
        usedRatio: 0.90,
        criticalRatio: 0.95,
        growthHorizonMinutes: 1,
        fastGrowthPerMinute: 0.05
    };
    const service = new B1StorageMaterialService({
        storage: {
            async read() {
                return { success: true, data: { items: { coal_block: 100 }, capacity: { usageRatio: 0.86, used: 860, limit: 1000 } } };
            }
        },
        minerals: {}, smelting: {}, conversionConfig: conversion,
        smeltingConfig: { recipes: { raw_iron_to_iron: { input: 'raw_iron', output: 'iron_ingot' } } }
    });
    service.lastPressureObservation = { usageRatio: 0.80, used: 800, at: Date.now() - 60_000 };

    const result = await service.inspectStoragePressure();
    assert.equal(result.success, true);
    assert.equal(result.data.usageRatio < 0.90, true);
    assert.equal(result.data.projectedRatio >= 0.90, true);
    assert.equal(result.data.projectedSellRequired, true);
    assert.equal(result.data.sellRequired, true);
});


test('relieveStoragePressure preserves the growth baseline long enough to perform a proactive sale', async () => {
    const conversion = config();
    conversion.storagePressure = {
        watchRatio: 0.75,
        highRatio: 0.85,
        usedRatio: 0.90,
        criticalRatio: 0.95,
        growthHorizonMinutes: 1,
        fastGrowthPerMinute: 0.05,
        maxSalesPerPass: 2
    };
    const sold = [];
    const snapshots = [
        { usageRatio: 0.86, items: { coal_block: 100 } },
        { usageRatio: 0.70, items: {} }
    ];
    const service = new B1StorageMaterialService({
        storage: {
            async read() {
                const next = snapshots.shift() || { usageRatio: 0.70, items: {} };
                return { success: true, data: { items: next.items, capacity: { usageRatio: next.usageRatio, used: next.usageRatio * 1000, limit: 1000 } } };
            },
            async sell(id, options = {}) { sold.push(id); return { success: true, data: { id } }; }
        },
        minerals: {}, smelting: {}, conversionConfig: conversion,
        smeltingConfig: { recipes: { raw_iron_to_iron: { input: 'raw_iron', output: 'iron_ingot' } } }
    });
    service.lastPressureObservation = { usageRatio: 0.80, used: 800, at: Date.now() - 60_000 };

    const result = await service.relieveStoragePressure();
    assert.equal(result.success, true);
    assert.deepEqual(sold, ['coal_block']);
    assert.equal(result.data.pressure.nearFull, false);
});


test('high-water protection starts selling at 80% and drains to 70% low-water', async () => {
    const conversion = config();
    conversion.storagePressure = {
        watchRatio: 0.70,
        highRatio: 0.80,
        usedRatio: 0.80,
        lowWaterRatio: 0.70,
        criticalRatio: 0.92,
        maxSalesPerPass: 4
    };
    const sold = [];
    const snapshots = [
        { usageRatio: 0.81, items: { coal_block: 500, diamond_block: 300 } },
        { usageRatio: 0.76, items: { coal_block: 0, diamond_block: 300 } },
        { usageRatio: 0.69, items: { coal_block: 0, diamond_block: 0 } }
    ];
    const service = new B1StorageMaterialService({
        storage: {
            async read() {
                const next = snapshots.shift() || { usageRatio: 0.69, items: {} };
                return { success: true, data: { items: next.items, capacity: { usageRatio: next.usageRatio, used: next.usageRatio * 1000, limit: 1000 } } };
            },
            async sell(id, options = {}) { sold.push(id); return { success: true, data: { id } }; }
        },
        minerals: {}, smelting: {}, conversionConfig: conversion,
        smeltingConfig: { recipes: {} }
    });

    const result = await service.relieveStoragePressure();
    assert.equal(result.success, true);
    assert.deepEqual(sold, [
        'coal_block', 'coal_block', 'coal_block', 'coal_block',
        'diamond_block', 'diamond_block', 'diamond_block', 'diamond_block'
    ]);
    assert.equal(result.data.pressure.usageRatio <= 0.70, true);
    assert.equal(result.data.reason, 'low-water-reached');
});

test('sale priority uses stock relative to B5 consumption instead of raw block count alone', async () => {
    const conversion = config();
    conversion.storagePressure = {
        highRatio: 0.80,
        usedRatio: 0.80,
        lowWaterRatio: 0.70,
        maxSalesPerPass: 1,
        maxSellBurstsPerPass: 1,
        materialGrowthWeightMinutes: 0
    };
    const sold = [];
    const service = new B1StorageMaterialService({
        storage: {
            async read() {
                return {
                    success: true,
                    data: {
                        // Coal has more blocks, but one target consumes 100 coal
                        // versus only 10 diamond. Diamond therefore has more
                        // target-coverage surplus and should be sold first.
                        items: { coal_block: 1000, diamond_block: 200 },
                        capacity: { usageRatio: 0.90, used: 900, limit: 1000 }
                    }
                };
            },
            async sell(id, options = {}) { sold.push(id); return { success: true, data: { id } }; }
        },
        minerals: {}, smelting: {}, conversionConfig: conversion,
        smeltingConfig: { recipes: {} },
        recipeConfig: {
            target: { output: 'target', outputAmount: 1, inputs: { coal: 100, diamond: 10 } }
        },
        targetId: 'target'
    });

    const result = await service.relieveStoragePressure();
    assert.equal(result.success, true);
    assert.deepEqual(sold, ['diamond_block']);
    assert.equal(result.data.actions[0].selected.baseId, 'diamond');
    assert.equal(result.data.actions[0].selected.coverageB5 > 0, true);
});

test('positive net inflow raises sale priority when stock coverage is otherwise similar', async () => {
    const conversion = config();
    conversion.storagePressure = {
        highRatio: 0.80,
        usedRatio: 0.80,
        lowWaterRatio: 0.70,
        maxSalesPerPass: 1,
        maxSellBurstsPerPass: 1,
        materialGrowthWeightMinutes: 5
    };
    const sold = [];
    const service = new B1StorageMaterialService({
        storage: {
            async read() {
                return {
                    success: true,
                    data: {
                        items: { coal_block: 100, diamond_block: 100 },
                        capacity: { usageRatio: 0.90, used: 900, limit: 1000 }
                    }
                };
            },
            async sell(id, options = {}) { sold.push(id); return { success: true, data: { id } }; }
        },
        minerals: {}, smelting: {}, conversionConfig: conversion,
        smeltingConfig: { recipes: {} },
        recipeConfig: { target: { output: 'target', outputAmount: 1, inputs: { coal: 90, diamond: 90 } } },
        targetId: 'target'
    });
    service.lastMaterialObservation = {
        items: { coal: 50, diamond: 100 },
        at: Date.now() - 60_000
    };

    const result = await service.relieveStoragePressure();
    assert.equal(result.success, true);
    assert.deepEqual(sold, ['coal_block']);
    assert.equal(result.data.actions[0].selected.growthPerMinute > 0, true);
});


test('high-water sale ignores large loose stock and sells compressed block surplus only', async () => {
    const conversion = config();
    conversion.storagePressure = {
        highRatio: 0.80, usedRatio: 0.80, lowWaterRatio: 0.70,
        maxSalesPerPass: 1, maxSellBurstsPerPass: 1, materialGrowthWeightMinutes: 0
    };
    const sold = [];
    const service = new B1StorageMaterialService({
        storage: {
            async read() {
                return {
                    success: true,
                    data: {
                        items: { diamond: 100000, diamond_block: 1, coal_block: 5000 },
                        capacity: { usageRatio: 0.90, used: 900000, limit: 1000000 }
                    }
                };
            },
            async sell(id, options = {}) { sold.push(id); return { success: true, data: { id } }; }
        },
        minerals: {}, smelting: {}, conversionConfig: conversion, smeltingConfig: { recipes: {} },
        recipeConfig: { target: { output: 'target', outputAmount: 1, inputs: { diamond: 32, coal: 32 } } },
        targetId: 'target'
    });

    const result = await service.relieveStoragePressure();
    assert.equal(result.success, true);
    assert.deepEqual(sold, ['coal_block']);
    assert.equal(result.data.actions[0].selected.logicalId, 'coal_block');
});

test('high-water sale still runs when later compaction would fail', async () => {
    const conversion = config();
    conversion.storagePressure = { highRatio: 0.80, usedRatio: 0.80, lowWaterRatio: 0.70, maxSalesPerPass: 2, maxProtectionPasses: 1 };
    const calls = [];
    const snapshots = [
        { items: { coal_block: 500 }, capacity: { usageRatio: 0.90, used: 900, limit: 1000 } },
        { items: { coal_block: 500 }, capacity: { usageRatio: 0.90, used: 900, limit: 1000 } },
        { items: {}, capacity: { usageRatio: 0.69, used: 690, limit: 1000 } },
        { items: { coal: 64 }, capacity: { usageRatio: 0.69, used: 690, limit: 1000 } },
        { items: { coal: 64 }, capacity: { usageRatio: 0.69, used: 690, limit: 1000 } }
    ];
    const service = new B1StorageMaterialService({
        storage: {
            async read() { return { success: true, data: snapshots.shift() || { items: {}, capacity: { usageRatio: 0.69, used: 690, limit: 1000 } } }; },
            async sell(id, options = {}) { calls.push(`sell:${id}`); return { success: true, data: { id } }; }
        },
        minerals: { async toBlocks(id) { calls.push(`block:${id}`); return { success: false, status: 'FAILED', message: 'GUI failed' }; } },
        smelting: {}, conversionConfig: conversion, smeltingConfig: { recipes: {} }
    });
    service.resources = Object.freeze({ coal: service.resources.coal });

    const result = await service.stabilizeStorage();
    assert.equal(result.success, true);
    assert.equal(calls[0], 'sell:coal_block');
    assert.equal(result.data.passes[0].compacted.failures.length, 1);
});



test('block-only protection compacts loose stock under high pressure instead of selling loose', async () => {
    const conversion = {
        smeltingRecipeIds: [],
        resources: { coal: { baseId: 'coal', blockId: 'coal_block', ratio: 9, sellId: 'coal_block' } },
        storagePressure: { highRatio: 0.80, lowWaterRatio: 0.70, maxSalesPerPass: 2, maxSellBurstsPerPass: 1, maxProtectionPasses: 1 }
    };
    const state = { coal: 900, coal_block: 0 };
    const sold = [];
    let compactCalls = 0;
    const storage = {
        config: { sell: { startupReserveCoverage: 3, pressureAllowSingle: false } },
        async read() {
            const used = Number(state.coal || 0) + Number(state.coal_block || 0);
            return { success: true, data: { items: { ...state }, capacity: { used, limit: 1000, usageRatio: used / 1000 } } };
        },
        async sell(id, options = {}) { sold.push({ id, ...options }); return { success: true, data: {} }; },
        async closeSellGui() { return { success: true }; }
    };
    const service = new B1StorageMaterialService({
        storage,
        minerals: {
            async toBlocks(id) {
                assert.equal(id, 'coal');
                compactCalls += 1;
                const blocks = Math.floor(state.coal / 9);
                state.coal -= blocks * 9;
                state.coal_block += blocks;
                return { success: true, data: { skipped: false } };
            }
        },
        smelting: {}, conversionConfig: conversion, smeltingConfig: { recipes: {} },
        recipeConfig: { target: { output: 'target', outputAmount: 1, inputs: { coal: 100 } } }, targetId: 'target'
    });

    const result = await service.stabilizeStorage();
    assert.equal(result.success, true);
    assert.deepEqual(sold, [], 'loose coal must never be a sell candidate');
    assert.equal(compactCalls, 1);
    assert.equal(state.coal, 0);
    assert.equal(state.coal_block, 100);
    assert.equal(result.data.pressure.usageRatio, 0.10);
});
test('startup trim uses /kho coverage including raw and stops at coarse 64-only reserve band', async () => {
    const conversion = {
        smeltingRecipeIds: ['raw_iron_to_iron'],
        resources: {
            iron_ingot: { baseId: 'iron_ingot', blockId: 'iron_block', ratio: 9, sellId: 'iron_block' },
            diamond: { baseId: 'diamond', blockId: 'diamond_block', ratio: 9, sellId: 'diamond_block' }
        },
        storagePressure: {}
    };
    const state = { raw_iron: 100, iron_ingot: 20, iron_block: 100, diamond: 250 };
    const sales = [];
    let reads = 0;
    const storage = {
        config: { sell: { startupReserveCoverage: 3, startupTrimEnabled: true, startupMaxClicks: 1000, replanEveryClicks: 2 } },
        async read() { reads += 1; return { success: true, data: { items: { ...state }, capacity: { used: 750, limit: 800000, usageRatio: 750 / 800000 } } }; },
        async sell(id, { quantity }) { sales.push({ id, quantity }); state[id] = Math.max(0, Number(state[id] || 0) - Number(quantity)); return { success: true, data: { logicalId: id, quantity } }; },
        async closeSellGui() { return { success: true }; }
    };
    const service = new B1StorageMaterialService({
        storage,
        minerals: {},
        smelting: { async smelt() { throw new Error('raw should not need smelting when sellable surplus is enough'); } },
        conversionConfig: conversion,
        smeltingConfig: { recipes: { raw_iron_to_iron: { input: 'raw_iron', output: 'iron_ingot' } } },
        recipeConfig: { target: { output: 'target', outputAmount: 1, inputs: { iron_ingot: 100, diamond: 100 } } },
        targetId: 'target'
    });

    const result = await service.startupTrimToReserve();
    assert.equal(result.success, true);
    assert.equal(result.data.finalCoverage.iron_ingot.coverage, 4.44);
    assert.equal(result.data.finalCoverage.diamond.coverage, 2.5);
    assert.equal(sales.some(action => action.id === 'raw_iron'), false);
    assert.deepEqual(sales, [{ id: 'iron_block', quantity: 64 }]);
    assert.equal(sales.filter(action => action.quantity === 1).length, 0);
    assert.equal(reads, 2, 'startup trim should read full /kho only at the beginning and final verification, not every sell batch');
});

test('startup trim ignores raw-only and loose-only surplus instead of converting them just to sell', async () => {
    const conversion = {
        smeltingRecipeIds: ['raw_iron_to_iron'],
        resources: { iron_ingot: { baseId: 'iron_ingot', blockId: 'iron_block', ratio: 9, sellId: 'iron_block' } },
        storagePressure: {}
    };
    const state = { raw_iron: 400, iron_ingot: 128, iron_block: 0 };
    const sales = [];
    let smelts = 0;
    const storage = {
        config: { sell: { startupReserveCoverage: 3, startupTrimEnabled: true, startupMaxClicks: 1000 } },
        async read() { return { success: true, data: { items: { ...state }, capacity: { used: 528, limit: 800000, usageRatio: 528 / 800000 } } }; },
        async sell(id, { quantity }) { sales.push({ id, quantity }); return { success: true, data: { logicalId: id, quantity } }; },
        async closeSellGui() { return { success: true }; }
    };
    const service = new B1StorageMaterialService({
        storage,
        minerals: {},
        smelting: { async smelt() { smelts += 1; return { success: true, data: { skipped: false } }; } },
        conversionConfig: conversion,
        smeltingConfig: { recipes: { raw_iron_to_iron: { input: 'raw_iron', output: 'iron_ingot' } } },
        recipeConfig: { target: { output: 'target', outputAmount: 1, inputs: { iron_ingot: 100 } } },
        targetId: 'target'
    });

    const result = await service.startupTrimToReserve();
    assert.equal(result.success, true);
    assert.equal(result.data.initialCoverage.iron_ingot.coverage, 5.28);
    assert.equal(smelts, 0, 'startup trim must not smelt raw just to create a sellable loose form');
    assert.deepEqual(sales, []);
});

test('simulation: slight surplus is accepted when another 64 sale would cross the 3-B5 reserve', async () => {
    const conversion = {
        smeltingRecipeIds: [],
        resources: { coal: { baseId: 'coal', blockId: 'coal_block', ratio: 9 } },
        storagePressure: {}
    };
    const state = { coal: 320, coal_block: 0 };
    const sales = [];
    const service = new B1StorageMaterialService({
        storage: {
            config: { sell: { startupReserveCoverage: 3, startupTrimEnabled: true, startupAllowSingle: false } },
            async read() { return { success: true, data: { items: { ...state }, capacity: { used: 320, limit: 800000, usageRatio: 0.0004 } } }; },
            async sell(id, { quantity }) { sales.push({ id, quantity }); return { success: true, data: { afterAmount: state[id] } }; },
            async closeSellGui() { return { success: true }; }
        },
        minerals: {}, smelting: {}, conversionConfig: conversion, smeltingConfig: { recipes: {} },
        recipeConfig: { target: { output: 'target', outputAmount: 1, inputs: { coal: 100 } } }, targetId: 'target'
    });

    const result = await service.startupTrimToReserve();
    assert.equal(result.success, true);
    assert.equal(result.data.finalCoverage.coal.coverage, 3.2);
    assert.equal(sales.length, 0, 'do not use single-click fine tuning just to chase exactly 3.0');
});

test('simulation: loose and block arriving together are one family but selling is block-only', async () => {
    const conversion = config();
    conversion.storagePressure = {
        highRatio: 0.80, lowWaterRatio: 0.70, maxSalesPerPass: 2, maxSellBurstsPerPass: 1
    };
    const sold = [];
    const service = new B1StorageMaterialService({
        storage: {
            async read() { return { success: true, data: { items: { coal: 64, coal_block: 1000 }, capacity: { usageRatio: 0.90, used: 900, limit: 1000 } } }; },
            async sell(id, { quantity }) { sold.push({ id, quantity }); return { success: true, data: {} }; },
            async closeSellGui() { return { success: true }; }
        },
        minerals: {}, smelting: {}, conversionConfig: conversion, smeltingConfig: { recipes: {} },
        recipeConfig: { target: { output: 'target', outputAmount: 1, inputs: { coal: 100 } } }, targetId: 'target'
    });

    const result = await service.relieveStoragePressure();
    assert.equal(result.success, true);
    assert.deepEqual(sold.map(entry => entry.id), ['coal_block', 'coal_block']);
    assert.equal(sold.every(entry => entry.quantity === 64), true);
});

test('simulation: refill that outpaces the first sell burst escalates the next bounded burst instead of restarting the mode', async () => {
    const conversion = config();
    conversion.storagePressure = {
        highRatio: 0.80, lowWaterRatio: 0.70,
        maxSalesPerPass: 2, maxSellBurstsPerPass: 3, maxSellBurstClicks: 4,
        sellBurstEscalationFactor: 2, minPressureImprovementRatio: 0.002
    };
    const checkpoints = [
        { ratio: 0.90, coal: 5000 },
        { ratio: 0.91, coal: 5200 }, // NPC added more than the first burst removed.
        { ratio: 0.78, coal: 3500 },
        { ratio: 0.69, coal: 2500 }
    ];
    let reads = 0;
    const sold = [];
    const service = new B1StorageMaterialService({
        storage: {
            async read() {
                reads += 1;
                const next = checkpoints.shift() || { ratio: 0.69, coal: 2500 };
                return { success: true, data: { items: { coal_block: next.coal }, capacity: { usageRatio: next.ratio, used: next.ratio * 1000, limit: 1000 } } };
            },
            async sell(id, { quantity }) { sold.push({ id, quantity }); return { success: true, data: {} }; },
            async closeSellGui() { return { success: true }; }
        },
        minerals: {}, smelting: {}, conversionConfig: conversion, smeltingConfig: { recipes: {} },
        recipeConfig: { target: { output: 'target', outputAmount: 1, inputs: { coal: 100 } } }, targetId: 'target'
    });

    const result = await service.relieveStoragePressure();
    assert.equal(result.success, true);
    assert.equal(result.data.reason, 'low-water-reached');
    assert.deepEqual(result.data.bursts.map(burst => burst.budget), [2, 4, 2]);
    assert.equal(result.data.bursts[0].improvement < 0, true, 'first burst lost ground to continuous inflow');
    assert.equal(reads, 4);
    assert.equal(sold.length, 8);
});

test('simulation: continuous inflow can mask a 64-sale delta and the next decision uses the observed larger amount', async () => {
    const conversion = config();
    conversion.storagePressure = {
        highRatio: 0.80, lowWaterRatio: 0.70, maxSalesPerPass: 2, maxSellBurstsPerPass: 1
    };
    const sold = [];
    let saleCall = 0;
    const service = new B1StorageMaterialService({
        storage: {
            async read() { return { success: true, data: { items: { coal_block: 1000 }, capacity: { usageRatio: 0.90, used: 900, limit: 1000 } } }; },
            async sell(id, { quantity }) {
                saleCall += 1;
                sold.push({ id, quantity });
                // After the first click the GUI amount is higher, not lower,
                // because NPC input arrived at the same time.
                return { success: true, data: { afterAmount: saleCall === 1 ? 1100 : 1036 } };
            },
            async closeSellGui() { return { success: true }; }
        },
        minerals: {}, smelting: {}, conversionConfig: conversion, smeltingConfig: { recipes: {} },
        recipeConfig: { target: { output: 'target', outputAmount: 1, inputs: { coal: 100 } } }, targetId: 'target'
    });

    const result = await service.relieveStoragePressure();
    assert.equal(result.success, true);
    assert.equal(sold.length, 2);
    assert.deepEqual(sold.map(entry => entry.quantity), [64, 64]);
});

test('simulation: high pressure with no material above the 3-B5 hard reserve never sells reserve stock', async () => {
    const conversion = config();
    conversion.storagePressure = {
        highRatio: 0.80, lowWaterRatio: 0.70, maxSalesPerPass: 8, maxSellBurstsPerPass: 2
    };
    const sold = [];
    const service = new B1StorageMaterialService({
        storage: {
            async read() { return { success: true, data: { items: { coal: 300 }, capacity: { usageRatio: 0.95, used: 950, limit: 1000 } } }; },
            async sell(id, options) { sold.push({ id, ...options }); return { success: true, data: {} }; },
            async closeSellGui() { return { success: true }; }
        },
        minerals: {}, smelting: {}, conversionConfig: conversion, smeltingConfig: { recipes: {} },
        recipeConfig: { target: { output: 'target', outputAmount: 1, inputs: { coal: 100 } } }, targetId: 'target'
    });

    const result = await service.relieveStoragePressure();
    assert.equal(result.success, true);
    assert.equal(result.data.reason, 'no-safe-surplus-above-reserve');
    assert.equal(sold.length, 0);
});

test('simulation: protection is bounded when NPC inflow keeps pressure flat forever', async () => {
    const conversion = config();
    conversion.storagePressure = {
        highRatio: 0.80, lowWaterRatio: 0.70,
        maxSalesPerPass: 2, maxSellBurstsPerPass: 3, maxSellBurstClicks: 4,
        sellBurstEscalationFactor: 2, minPressureImprovementRatio: 0.002
    };
    let reads = 0;
    let sells = 0;
    const service = new B1StorageMaterialService({
        storage: {
            async read() { reads += 1; return { success: true, data: { items: { coal_block: 10000 }, capacity: { usageRatio: 0.90, used: 900, limit: 1000 } } }; },
            async sell() { sells += 1; return { success: true, data: { afterAmount: 10000 } }; },
            async closeSellGui() { return { success: true }; }
        },
        minerals: {}, smelting: {}, conversionConfig: conversion, smeltingConfig: { recipes: {} },
        recipeConfig: { target: { output: 'target', outputAmount: 1, inputs: { coal: 100 } } }, targetId: 'target'
    });

    const result = await service.relieveStoragePressure();
    assert.equal(result.success, true);
    assert.equal(result.data.reason, 'pressure-persists-after-bounded-bursts');
    assert.deepEqual(result.data.bursts.map(burst => burst.budget), [2, 4, 4]);
    assert.equal(sells, 10);
    assert.equal(reads, 4, 'initial checkpoint plus one checkpoint per bounded burst');
});


test('startup trim ignores an unreliable sell-GUI amount=1 and continues coarse block sales from /kho state', async () => {
    const conversion = {
        smeltingRecipeIds: [],
        resources: { gold_ingot: { baseId: 'gold_ingot', blockId: 'gold_block', ratio: 9 } },
        storagePressure: {}
    };
    const state = { gold_ingot: 0, gold_block: 512 };
    const sales = [];
    let reads = 0;
    const storage = {
        config: {
            sell: {
                startupReserveCoverage: 3,
                startupStopCoverage: 3.25,
                startupTrimEnabled: true,
                startupAllowSingle: false,
                startupCheckpointClicks: 64,
                startupMaxPasses: 2,
                startupMaxClicks: 1000
            }
        },
        async read() {
            reads += 1;
            return { success: true, data: { items: { ...state }, capacity: { used: state.gold_block, limit: 800000 } } };
        },
        async sell(id, { quantity }) {
            sales.push({ id, quantity });
            state[id] = Math.max(0, Number(state[id] || 0) - Number(quantity));
            // Reproduce the runtime bug: Sell GUI parser surfaced the click
            // instruction quantity "1" instead of the real stored amount.
            return { success: true, data: { afterAmount: 1, amountReliable: false, transitioned: true } };
        },
        async closeSellGui() { return { success: true }; }
    };
    const service = new B1StorageMaterialService({
        storage,
        minerals: {}, smelting: {}, conversionConfig: conversion, smeltingConfig: { recipes: {} },
        recipeConfig: { target: { output: 'target', outputAmount: 1, inputs: { gold_ingot: 100 } } },
        targetId: 'target'
    });

    const result = await service.startupTrimToReserve();
    assert.equal(result.success, true);
    assert.equal(sales.length, 7, 'unreliable afterAmount=1 must not collapse local block stock after the first click');
    assert.equal(state.gold_block, 64);
    assert.equal(reads >= 2, true);
});

test('startup trim keeps one sell session for hundreds of coarse 64 sales when sell GUI reports bogus reliable zero', async () => {
    const conversion = {
        smeltingRecipeIds: [],
        resources: { gold_ingot: { baseId: 'gold_ingot', blockId: 'gold_block', ratio: 9 } },
        storagePressure: {}
    };
    const state = { gold_ingot: 0, gold_block: 92286 };
    let reads = 0;
    let closes = 0;
    let sells = 0;
    const storage = {
        config: {
            sell: {
                startupReserveCoverage: 3,
                startupStopCoverage: 3.25,
                startupTrimEnabled: true,
                startupAllowSingle: false,
                startupCheckpointClicks: 512,
                startupMaxPasses: 6,
                startupMaxClicks: 20000
            }
        },
        async read() {
            reads += 1;
            return { success: true, data: { items: { ...state }, capacity: { used: state.gold_block, limit: 800000 } } };
        },
        async sell(id, { quantity }) {
            sells += 1;
            state[id] = Math.max(0, Number(state[id] || 0) - Number(quantity));
            // Match the observed runtime failure: the Sell GUI claimed a
            // reliable zero even while /kho held >90k blocks.
            return { success: true, data: { afterAmount: 0, amountReliable: true, transitioned: true } };
        },
        async closeSellGui() { closes += 1; return { success: true }; }
    };
    const service = new B1StorageMaterialService({
        storage,
        minerals: {}, smelting: {}, conversionConfig: conversion, smeltingConfig: { recipes: {} },
        recipeConfig: { target: { output: 'target', outputAmount: 1, inputs: { gold_ingot: 196608 } } },
        targetId: 'target'
    });

    const result = await service.startupTrimToReserve();
    assert.equal(result.success, true);
    assert.equal(sells, 333, '4.23 B5 coverage should be drained to the relative 3.25 band in one long burst');
    assert.equal(reads, 2, 'only initial /kho plus one full checkpoint should be needed');
    assert.equal(closes, 1, 'Sell GUI should stay open throughout the 333-click burst');
    assert.ok(result.data.finalCoverage.gold_ingot.coverage <= 3.25);
    assert.ok(result.data.finalCoverage.gold_ingot.coverage >= 3);
});

test('fast projection below low-water stays RISING and never activates hard protection', async () => {
    const conversion = config();
    conversion.storagePressure = {
        watchRatio: 0.70,
        highRatio: 0.80,
        lowWaterRatio: 0.70,
        criticalRatio: 0.92,
        growthHorizonMinutes: 0.5,
        fastGrowthPerMinute: 0.03
    };
    const service = new B1StorageMaterialService({
        storage: {
            async read() {
                return { success: true, data: { items: { coal_block: 100 }, capacity: { usageRatio: 0.233, used: 186400, limit: 800000 } } };
            }
        },
        minerals: {}, smelting: {}, conversionConfig: conversion,
        smeltingConfig: { recipes: {} }
    });
    service.lastPressureObservation = { usageRatio: 0.20, used: 160000, at: Date.now() - 1000 };

    const result = await service.inspectStoragePressure();
    assert.equal(result.success, true);
    assert.equal(result.data.projectedRatio >= 0.80, true, 'fixture must create an exaggerated projected spike');
    assert.equal(result.data.usageRatio < result.data.lowWaterRatio, true);
    assert.equal(result.data.level, 'RISING');
    assert.equal(result.data.protectionRequired, false);
    assert.equal(result.data.sellRequired, false);
    assert.equal(result.data.projectedSellRequired, false);
});
