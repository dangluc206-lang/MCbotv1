'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const B1StorageMaterialService = require('../../../src/server-features/storage/B1StorageMaterialService');
const KhoSellOperation = require('../../../src/server-features/storage/KhoSellOperation');

function conversionConfig(overrides = {}) {
    return {
        smeltingRecipeIds: ['raw_iron_to_iron', 'raw_gold_to_gold', 'cobblestone_to_stone'],
        resources: {
            cobblestone: { baseId: 'cobblestone', blockId: null, ratio: 1, sellId: 'cobblestone' },
            coal: { baseId: 'coal', blockId: 'coal_block', ratio: 9, sellId: 'coal_block' },
            iron_ingot: { baseId: 'iron_ingot', blockId: 'iron_block', ratio: 9, sellId: 'iron_block' },
            gold_ingot: { baseId: 'gold_ingot', blockId: 'gold_block', ratio: 9, sellId: 'gold_block' },
            diamond: { baseId: 'diamond', blockId: 'diamond_block', ratio: 9, sellId: 'diamond_block' }
        },
        ...overrides
    };
}

function smeltingConfig(overrides = {}) {
    return {
        verificationAttempts: 3,
        verificationRetryMs: 0,
        recipes: {
            raw_iron_to_iron: { input: 'raw_iron', output: 'iron_ingot' },
            raw_gold_to_gold: { input: 'raw_gold', output: 'gold_ingot' },
            cobblestone_to_stone: { input: 'cobblestone', output: 'stone' }
        },
        ...overrides
    };
}

function recipeConfig() {
    return {
        super_alloy: {
            outputAmount: 1,
            inputs: { cobblestone: 16, coal: 16, iron_ingot: 64, gold_ingot: 64, diamond: 32 }
        }
    };
}

function snap(items, { used = null, limit = 800000, capturedAt = Date.now() } = {}) {
    const capacity = used === null ? null : { used, limit, usageRatio: used / limit };
    return { items: { ...items }, capacity, capturedAt };
}

function okSnapshot(items, meta = {}) {
    return { success: true, data: snap(items, meta) };
}

function hardReserveState(overrides = {}) {
    return {
        cobblestone: 24,
        coal_block: 3,
        iron_block: 11,
        gold_block: 11,
        diamond_block: 6,
        ...overrides
    };
}

function makeService({ storage = {}, minerals = {}, smelting = {}, conversion = conversionConfig(), smeltingCfg = smeltingConfig(), recipes = recipeConfig(), now = Date.now } = {}) {
    storage.config ||= { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: false, allowAll: false, blockOnly: true } };
    return new B1StorageMaterialService({
        storage,
        minerals,
        smelting,
        conversionConfig: conversion,
        smeltingConfig: smeltingCfg,
        recipeConfig: recipes,
        logger: null,
        now
    });
}

test('storage protection status exposes only the batch policy and reserve source', () => {
    const service = makeService();
    assert.deepEqual(service.status(), {
        storageProtection: {
            enabled: true,
            sellingCapabilityEnabled: true,
            reserveCoverage: 1.5,
            sellQuantity: 64,
            allowSingle: false,
            smeltingRecipeIds: ['raw_iron_to_iron', 'raw_gold_to_gold']
        }
    });
    assert.equal(service.status().storageProtection.storagePressure, undefined);
});

test('B5 smelting allowlist permanently excludes stone even if configured', () => {
    const service = makeService();
    assert.deepEqual(service.smeltingRecipeIds, ['raw_iron_to_iron', 'raw_gold_to_gold']);
});

test('effectiveItems expands compacted stock into B1-equivalent units', () => {
    const service = makeService({ minerals: { isAvailable() { return true; } } });
    const items = service.effectiveItems({ coal: 3, coal_block: 10, diamond_block: 2 });
    assert.equal(items.coal, 93);
    assert.equal(items.diamond, 18);
});

test('effectiveItems does not count block stock when block-to-base capability is unavailable', () => {
    const service = makeService({
        minerals: { isAvailable(baseId, direction) { return !(baseId === 'coal' && direction === 'toBase'); } }
    });
    const items = service.effectiveItems({ coal: 3, coal_block: 10, diamond_block: 2 });
    assert.equal(items.coal, 3);
    assert.equal(items.diamond, 18);
});

test('preprocessForCraft blocks the protection episode when required smelting option is unavailable', async () => {
    let smeltCalls = 0;
    const service = makeService({
        storage: { async read() { return okSnapshot({ raw_iron: 128, iron_ingot: 5 }); } },
        smelting: {
            async smelt(id) {
                assert.equal(id, 'raw_iron_to_iron');
                smeltCalls += 1;
                return { success: true, data: { skipped: true, reason: 'option-unavailable' } };
            }
        }
    });

    const result = await service.preprocessForCraft();
    assert.equal(result.success, false);
    assert.equal(result.status, 'NOT_READY');
    assert.equal(result.error.code, 'B1_B5_PROTECTION_SMELT_UNVERIFIED');
    assert.equal(smeltCalls, 1);
});

test('smelting verification polls fresh /kho until telemetry reflects server state', async () => {
    const reads = [
        okSnapshot({ raw_iron: 128, iron_ingot: 5 }),
        okSnapshot({ raw_iron: 128, iron_ingot: 5 }),
        okSnapshot({ raw_iron: 0, iron_ingot: 133 })
    ];
    const refreshFlags = [];
    const service = makeService({
        storage: {
            async read(options = {}) {
                refreshFlags.push(Boolean(options.refresh));
                return reads.shift() || okSnapshot({ raw_iron: 0, iron_ingot: 133 });
            }
        },
        smelting: { async smelt() { return { success: true, data: { skipped: false } }; } }
    });

    const result = await service.preprocessForCraft();
    assert.equal(result.success, true);
    assert.equal(result.data.actions[0].afterInput, 0);
    assert.equal(result.data.actions[0].afterOutput, 133);
    assert.equal(result.data.actions[0].verificationAttempt, 2);
    assert.deepEqual(refreshFlags, [false, true, true]);
});

test('pure B5 unbounded decompression ignores /kho headroom ratio', async () => {
    const state = { coal: 2, coal_block: 20 };
    let converted = 0;
    const service = makeService({
        storage: {
            async read() {
                return { success: true, data: snap(state, { used: 790000, limit: 800000 }) };
            }
        },
        minerals: {
            async toBase(id) {
                assert.equal(id, 'coal');
                converted += 1;
                state.coal += state.coal_block * 9;
                state.coal_block = 0;
                return { success: true, data: {} };
            }
        }
    });

    const result = await service.ensureBaseAvailable('coal', 64, { decompressionPolicy: 'unbounded' });
    assert.equal(result.success, true);
    assert.equal(result.data.ready, true);
    assert.equal(converted, 1);
});

test('Collector+B5 guarded decompression waits when projected /kho usage exceeds its own limit', async () => {
    const service = makeService({
        storage: {
            async read() {
                return { success: true, data: snap({ coal: 2, coal_block: 20 }, { used: 640000, limit: 800000 }) };
            }
        },
        minerals: { async toBase() { throw new Error('must not expand'); } }
    });

    const result = await service.ensureBaseAvailable('coal', 64, {
        decompressionPolicy: 'guarded',
        decompressionMaxRatioOverride: 0.8,
        requireKnownCapacityOverride: true
    });
    assert.equal(result.success, true);
    assert.equal(result.data.ready, false);
    assert.equal(result.data.reason, 'unsafe-block-expansion');
    assert.equal(result.data.expansion.maxRatio, 0.8);
});

test('Collector+B5 guarded decompression uses the mode-provided ratio, not a global pressure policy', async () => {
    const state = { coal: 2, coal_block: 20 };
    let converted = 0;
    const service = makeService({
        storage: {
            async read() {
                return { success: true, data: snap(state, { used: 600000, limit: 800000 }) };
            }
        },
        minerals: {
            async toBase() {
                converted += 1;
                state.coal += state.coal_block * 9;
                state.coal_block = 0;
                return { success: true, data: {} };
            }
        }
    });

    const result = await service.ensureBaseAvailable('coal', 64, {
        decompressionPolicy: 'guarded',
        decompressionMaxRatioOverride: 0.9,
        requireKnownCapacityOverride: true
    });
    assert.equal(result.success, true);
    assert.equal(result.data.ready, true);
    assert.equal(converted, 1);
});

test('unavailable block-to-base conversion is waiting, not a fatal error', async () => {
    const service = makeService({
        storage: { async read() { return okSnapshot({ coal: 2, coal_block: 20 }); } },
        minerals: { async toBase() { return { success: true, data: { skipped: true, reason: 'option-unavailable' } }; } }
    });

    const result = await service.ensureBaseAvailable('coal', 64);
    assert.equal(result.success, true);
    assert.equal(result.data.ready, false);
    assert.equal(result.data.reason, 'option-unavailable');
});

test('compact converts loose B1 back to block form and verifies the result', async () => {
    const state = { coal: 90, coal_block: 1 };
    const service = makeService({
        storage: { async read() { return { success: true, data: snap(state) }; } },
        minerals: {
            async toBlocks(id) {
                assert.equal(id, 'coal');
                state.coal_block += Math.floor(state.coal / 9);
                state.coal %= 9;
                return { success: true, data: {} };
            }
        }
    });

    const result = await service.compact('coal');
    assert.equal(result.success, true);
    assert.equal(result.data.converted, true);
    assert.equal(state.coal, 0);
    assert.equal(state.coal_block, 11);
});

test('protectForB5Batch runs fresh read -> iron/gold smelt -> compact -> reserve trim and never smelts stone', async () => {
    const events = [];
    const state = {
        cobblestone: 24,
        raw_iron: 64,
        raw_gold: 64,
        iron_ingot: 0,
        gold_ingot: 0,
        coal: 90,
        coal_block: 100,
        iron_block: 20,
        gold_block: 20,
        diamond: 0,
        diamond_block: 10
    };
    const storage = {
        config: { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: true, allowAll: false, blockOnly: true } },
        async closeSellGui() { events.push('close-sell'); },
        async read(options = {}) {
            events.push(options.forceReopen ? 'read:fresh' : 'read');
            return { success: true, data: snap(state) };
        },
        async sell(id, { quantity }) {
            events.push(`sell:${id}:${quantity}`);
            state[id] = Math.max(0, Number(state[id] || 0) - Number(quantity));
            return { success: true, data: { skipped: false, sold: quantity, transitioned: true, semanticAcknowledged: true } };
        }
    };
    const smelting = {
        async smelt(id) {
            events.push(`smelt:${id}`);
            if (id === 'raw_iron_to_iron') {
                state.iron_ingot += state.raw_iron;
                state.raw_iron = 0;
            } else if (id === 'raw_gold_to_gold') {
                state.gold_ingot += state.raw_gold;
                state.raw_gold = 0;
            } else {
                throw new Error(`unexpected smelt ${id}`);
            }
            return { success: true, data: { skipped: false } };
        }
    };
    const minerals = {
        isAvailable() { return true; },
        async toBlocks(baseId) {
            events.push(`compact:${baseId}`);
            const resource = conversionConfig().resources[baseId];
            if (resource?.blockId) {
                const count = Math.floor(Number(state[baseId] || 0) / resource.ratio);
                state[resource.blockId] = Number(state[resource.blockId] || 0) + count;
                state[baseId] = Number(state[baseId] || 0) - count * resource.ratio;
            }
            return { success: true, data: {} };
        }
    };

    const service = makeService({ storage, minerals, smelting });
    const result = await service.protectForB5Batch();
    assert.equal(result.success, true);
    assert.equal(result.data.reserveCoverage, 1.5);

    const smelts = events.filter(event => event.startsWith('smelt:'));
    assert.deepEqual(smelts, ['smelt:raw_iron_to_iron', 'smelt:raw_gold_to_gold']);
    assert.equal(events.some(event => event.includes('cobblestone_to_stone')), false);
    assert.ok(events.indexOf('read:fresh') < events.indexOf('smelt:raw_iron_to_iron'));
    assert.ok(events.indexOf('smelt:raw_gold_to_gold') < events.findIndex(event => event.startsWith('compact:')));
    assert.ok(events.findIndex(event => event.startsWith('compact:')) < events.findIndex(event => event.startsWith('sell:')));

    const finalCoverage = service.coverageSnapshot(result.data.finalSnapshot);
    for (const family of Object.values(finalCoverage)) {
        assert.ok(family.coverage >= 1.5 || family.effectiveB1 < family.requiredPerB5 * 1.5);
        const selected = service.materialPolicy.selectReserveSaleAction(
            result.data.finalSnapshot.items,
            finalCoverage,
            1.5,
            new Set(),
            {},
            { allowSingle: true, minCoverageToSell: 1.5 }
        );
        assert.equal(selected, null, 'no family should still have sellable surplus above 1.5 B5');
        break;
    }
});

test('protectForB5Batch enforces hard 1.5 B5 reserve and does not need pass/burst/click/forecast fields', async () => {
    const state = hardReserveState({ coal_block: 130 });
    const service = makeService({
        storage: {
            config: { sell: { enabled: true, reserveCoverage: 9, allowSingle: true, blockOnly: true } },
            async closeSellGui() {},
            async read() { return { success: true, data: snap(state) }; },
            async sell(id, { quantity }) {
                state[id] -= Number(quantity);
                return { success: true, data: { skipped: false, transitioned: true, semanticAcknowledged: true } };
            }
        },
        minerals: { async toBlocks() { return { success: true, data: { skipped: true } }; } },
        smelting: { async smelt() { return { success: true, data: { skipped: true } }; } }
    });

    const result = await service.protectForB5Batch();
    assert.equal(result.success, true);
    assert.equal(result.data.reserveCoverage, 1.5);
    assert.equal(state.coal_block, 66, '64-only sale keeps the final 63-block surplus remainder above the 3-block reserve');
});

test('reconfigure keeps the hard 64-only sale and 1.5 B5 reserve contract', () => {
    const storage = {
        config: { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: true } },
        reconfigure(next) { this.config = next; }
    };
    const service = makeService({ storage });
    const nextStorage = { sell: { enabled: true, reserveCoverage: 2, allowSingle: true } };
    const status = service.reconfigure({ conversionConfig: conversionConfig(), storageConfig: nextStorage });
    assert.equal(status.storageProtection.reserveCoverage, 1.5);
    assert.equal(status.storageProtection.allowSingle, false);
});


test('unverified required smelting stops protection before compact or sell with diagnostic evidence', async () => {
    let compactCalls = 0;
    let sellCalls = 0;
    const service = makeService({
        smeltingCfg: smeltingConfig({ verificationAttempts: 2, verificationRetryMs: 0 }),
        storage: {
            config: { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: true, allowAll: false, blockOnly: true } },
            async closeSellGui() { return { success: true }; },
            async read() { return okSnapshot({ raw_iron: 64, iron_ingot: 0 }); },
            async sell() { sellCalls += 1; return { success: true, data: {} }; }
        },
        smelting: { async smelt() { return { success: true, data: { skipped: false } }; } },
        minerals: { async toBlocks() { compactCalls += 1; return { success: true, data: {} }; } }
    });
    const result = await service.protectForB5Batch({
        expectedGeneration: 8,
        batchId: 'batch-1', trigger: 'explicit-enable',
        operationContext: { operationId: 'op-1', correlationId: 'corr-1', botId: 'bot-01', connectionGeneration: 8 }
    });
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'B1_B5_PROTECTION_SMELT_UNVERIFIED');
    assert.equal(compactCalls, 0);
    assert.equal(sellCalls, 0);
    assert.equal(result.error.details.recipeId, 'raw_iron_to_iron');
    assert.equal(result.error.details.attempts, 2);
    assert.equal(result.error.details.expectedGeneration, 8);
    assert.equal(result.error.details.operationId, 'op-1');
    assert.equal(result.error.details.correlationId, 'corr-1');
});

test('conversion unavailable during protection is a finite blocker and never opens sell', async () => {
    let sells = 0;
    let reads = 0;
    const service = makeService({
        storage: {
            config: { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: true, allowAll: false, blockOnly: true } },
            async closeSellGui() { return { success: true }; },
            async read() { reads += 1; return okSnapshot({ coal: 90, coal_block: 0 }); },
            async sell() { sells += 1; return { success: true, data: {} }; }
        },
        smelting: { async smelt() { throw new Error('no raw should be smelted'); } },
        minerals: { async toBlocks(baseId) { if (baseId === 'coal') return { success: true, data: { skipped: true, reason: 'option-unavailable' } }; return { success: true, data: { skipped: true, reason: 'below-block-ratio' } }; } }
    });
    const result = await service.protectForB5Batch({ expectedGeneration: 3, batchId: 'batch-c' });
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'B1_B5_PROTECTION_COMPACT_UNVERIFIED');
    assert.equal(sells, 0);
    assert.ok(reads < 20, 'conversion blocker must terminate without hot retry');
});

test('bounded sell episode never expands click budget when independently proven new input arrives after immutable baseline', async () => {
    const state = hardReserveState({ coal_block: 131 });
    let sells = 0;
    const service = makeService({
        storage: {
            config: { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: true, allowAll: false, blockOnly: true } },
            async closeSellGui() { return { success: true }; },
            async read() {
                // Inject new input only after every baseline action was independently
                // verified. The final authoritative /kho read may classify this as
                // deferred input without expanding the episode budget.
                if (sells === 2 && !this.inflowInjected) {
                    this.inflowInjected = true;
                    state.coal_block += 2;
                }
                return okSnapshot(state);
            },
            async sell(id, { quantity }) {
                sells += 1;
                assert.equal(quantity, 64);
                state[id] = Math.max(0, Number(state[id] || 0) - Number(quantity));
                return { success: true, data: { skipped: false, verifiedSoldQuantity: Number(quantity) } };
            }
        },
        minerals: { async toBlocks() { return { success: true, data: { skipped: true, reason: 'below-block-ratio' } }; } },
        smelting: { async smelt() { throw new Error('no raw'); } }
    });
    const result = await service.protectForB5Batch({ expectedGeneration: 4, batchId: 'batch-flow', trigger: 'explicit-enable' });
    assert.equal(result.success, true);
    assert.equal(result.data.trimmed.clickBudget, 2, 'budget comes only from the 131-block baseline and 1.5 B5 reserve');
    assert.equal(sells, 2, 'new inflow must not add 64-clicks to the current episode');
    assert.deepEqual(result.data.trimmed.deferredNewInput, {});
    assert.equal(result.data.trimmed.completeForEpisode, true);
});

test('large 64-only budget resumes the same episode without repeating compact or absorbing new inflow', async () => {
    const state = hardReserveState({ coal: 9, coal_block: 4162 });
    const quantities = [];
    let compactCalls = 0;
    const service = makeService({
        storage: {
            config: { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: false, allowAll: false, blockOnly: true } },
            async closeSellGui() { return { success: true }; },
            async read() { return okSnapshot(state); },
            async sell(id, { quantity }) {
                quantities.push(quantity);
                state[id] -= quantity;
                return { success: true, data: { skipped: false, verifiedSoldQuantity: quantity } };
            }
        },
        minerals: {
            async toBlocks(baseId) {
                compactCalls += 1;
                assert.equal(baseId, 'coal');
                state.coal_block += 1;
                state.coal = 0;
                return { success: true, data: { skipped: false } };
            }
        },
        smelting: { async smelt() { throw new Error('no raw input should be smelted'); } }
    });
    const common = {
        expectedGeneration: 7,
        batchId: 'batch-large',
        trigger: 'explicit-enable',
        episodeId: 'batch-large:storage-protection'
    };

    const first = await service.protectForB5Batch({
        ...common,
        operationContext: {
            operationId: 'op-large-1', correlationId: common.episodeId,
            botId: 'bot-01', connectionGeneration: 7, remainingMs: () => 1000000
        }
    });
    assert.equal(first.success, true);
    assert.equal(first.data.continuationRequired, true);
    assert.equal(first.data.trimmed.sliceClicks, 64);
    assert.equal(first.data.trimmed.actionsRemaining, 1);
    assert.equal(compactCalls, 1);

    state.coal_block += 64; // Must be deferred to the next B5 batch.

    const second = await service.protectForB5Batch({
        ...common,
        operationContext: {
            operationId: 'op-large-2', correlationId: common.episodeId,
            botId: 'bot-01', connectionGeneration: 7, remainingMs: () => 1000000
        }
    });
    assert.equal(second.success, true);
    assert.equal(second.data.resumedSellEpisode, true);
    assert.equal(second.data.continuationRequired, false);
    assert.equal(second.data.completeForEpisode, true);
    assert.equal(compactCalls, 1, 'continuation must not repeat the pre-baseline compaction boundary');
    assert.equal(quantities.length, 65);
    assert.ok(quantities.every(quantity => quantity === 64));
    assert.equal(state.coal_block, 67, '3-block reserve plus 64 new-inflow blocks must remain');
    assert.deepEqual(second.data.trimmed.deferredNewInput, {});
    assert.equal(second.data.trimmed.sellEvidenceCount, 65);
    assert.equal(second.data.trimmed.sellEvidence.length, 32, 'large episodes keep bounded diagnostic evidence');
});

test('sub-64 surplus is retained and never emits a quantity-1 sale', async () => {
    const state = hardReserveState({ coal_block: 10 });
    const quantities = [];
    const service = makeService({
        storage: {
            config: { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: true, allowAll: false, blockOnly: true } },
            async closeSellGui() { return { success: true }; },
            async read() { return okSnapshot(state); },
            async sell(_id, { quantity }) { quantities.push(quantity); return { success: true, data: { verifiedSoldQuantity: quantity } }; }
        }
    });
    const result = await service.startupTrimToReserve({
        initialSnapshot: snap(state), batchId: 'sub-64', episodeId: 'sub-64:episode'
    });
    assert.equal(result.success, true);
    assert.equal(result.data.completeForEpisode, true);
    assert.equal(result.data.clickBudget, 0);
    assert.equal(result.data.retainedRemainderItems.coal_block, 7);
    assert.deepEqual(quantities, []);
});

test('sell slice treats null operation remaining time as no root deadline', async () => {
    const state = hardReserveState({ coal_block: 70 });
    const quantities = [];
    const service = makeService({
        storage: {
            config: { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: false, allowAll: false, blockOnly: true } },
            async closeSellGui() { return { success: true }; },
            async read() { return okSnapshot(state); },
            async sell(id, { quantity }) {
                quantities.push(quantity);
                state[id] = Math.max(0, Number(state[id] || 0) - Number(quantity));
                return { success: true, data: { skipped: false, verifiedSoldQuantity: quantity } };
            }
        }
    });
    const result = await service.startupTrimToReserve({
        initialSnapshot: snap(state), batchId: 'no-root-deadline', episodeId: 'no-root-deadline:episode',
        expectedGeneration: 3,
        operationContext: { operationId: 'no-root-deadline-1', connectionGeneration: 3, remainingMs: () => null }
    });
    assert.equal(result.success, true);
    assert.equal(result.data.deadlineYielded, false);
    assert.equal(result.data.completeForEpisode, true);
    assert.deepEqual(quantities, [64]);
});

test('sell slice yields before the operation deadline and resumes without timeout', async () => {
    const state = hardReserveState({ coal_block: 70 });
    const quantities = [];
    const service = makeService({
        storage: {
            config: { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: false, allowAll: false, blockOnly: true } },
            async closeSellGui() { return { success: true }; },
            async read() { return okSnapshot(state); },
            async sell(id, { quantity }) {
                quantities.push(quantity);
                state[id] -= quantity;
                return { success: true, data: { skipped: false, verifiedSoldQuantity: quantity } };
            }
        }
    });
    const episodeId = 'deadline-yield:episode';
    const first = await service.startupTrimToReserve({
        initialSnapshot: snap(state), batchId: 'deadline-yield', episodeId,
        expectedGeneration: 3,
        operationContext: { operationId: 'deadline-1', connectionGeneration: 3, remainingMs: () => 20000 }
    });
    assert.equal(first.success, true);
    assert.equal(first.data.continuationRequired, true);
    assert.equal(first.data.deadlineYielded, true);
    assert.equal(first.data.sliceClicks, 0);
    assert.deepEqual(quantities, []);

    const second = await service.startupTrimToReserve({
        batchId: 'deadline-yield', episodeId, expectedGeneration: 3,
        operationContext: { operationId: 'deadline-2', connectionGeneration: 3, remainingMs: () => 1000000 }
    });
    assert.equal(second.success, true);
    assert.equal(second.data.completeForEpisode, true);
    assert.deepEqual(quantities, [64]);
});

test('800000-item worst-case storage budget is capped to one 64-click slice', async () => {
    const state = hardReserveState({ coal_block: 800000 });
    const quantities = [];
    const service = makeService({
        storage: {
            config: { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: false, allowAll: false, blockOnly: true } },
            async closeSellGui() { return { success: true }; },
            async read() { return okSnapshot(state, { used: 800000, limit: 800000 }); },
            async sell(id, { quantity }) {
                quantities.push(quantity);
                state[id] -= quantity;
                return { success: true, data: { skipped: false, verifiedSoldQuantity: quantity } };
            }
        }
    });
    const result = await service.startupTrimToReserve({
        initialSnapshot: snap(state, { used: 800000, limit: 800000 }),
        batchId: 'worst-capacity',
        episodeId: 'worst-capacity:episode',
        expectedGeneration: 9,
        operationContext: { operationId: 'worst-1', connectionGeneration: 9, remainingMs: () => 3000000 }
    });
    assert.equal(result.success, true);
    assert.equal(result.data.continuationRequired, true);
    assert.equal(result.data.clickBudget, 12499);
    assert.equal(result.data.sliceClicks, 64);
    assert.equal(result.data.actionsRemaining, 12435);
    assert.equal(result.data.retainedRemainderItems.coal_block, 61);
    assert.equal(quantities.length, 64);
    assert.ok(quantities.every(quantity => quantity === 64));
    service.discardProtectionEpisode('worst-capacity:episode');
});

test('episode-level unavailable sell candidate returns one finite blocker instead of retrying forever', async () => {
    const state = hardReserveState({ coal_block: 131 });
    let sells = 0;
    const service = makeService({
        storage: {
            config: { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: true, allowAll: false, blockOnly: true } },
            async closeSellGui() { return { success: true }; },
            async read() { return okSnapshot(state); },
            async sell() { sells += 1; return { success: true, data: { skipped: true, reason: 'sell-entry-unavailable' } }; }
        },
        minerals: { async toBlocks() { return { success: true, data: { skipped: true, reason: 'below-block-ratio' } }; } },
        smelting: { async smelt() { throw new Error('no raw'); } }
    });
    const result = await service.protectForB5Batch({ expectedGeneration: 5, batchId: 'batch-blocked' });
    assert.equal(result.success, false);
    assert.equal(result.status, 'NOT_READY');
    assert.equal(result.error.code, 'B1_B5_PROTECTION_SELL_BLOCKED');
    assert.equal(sells, 1);
    assert.equal(result.meta?.details?.completeForEpisode ?? result.error.details?.completeForEpisode, false);
});

test('an unavailable material does not block later materials and retry never replays acknowledged sales', async () => {
    const state = hardReserveState({ lapis_block: 80, iron_block: 80 });
    const calls = [];
    let lapisAttempts = 0;
    const service = makeService({
        conversion: conversionConfig({
            resources: {
                lapis_lazuli: { baseId: 'lapis_lazuli', blockId: 'lapis_block', ratio: 9, sellId: 'lapis_block' },
                iron_ingot: { baseId: 'iron_ingot', blockId: 'iron_block', ratio: 9, sellId: 'iron_block' }
            }
        }),
        recipes: {
            super_alloy: {
                outputAmount: 1,
                inputs: { lapis_lazuli: 64, iron_ingot: 64 }
            }
        },
        storage: {
            config: { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: false, allowAll: false, blockOnly: true } },
            async closeSellGui() { return { success: true }; },
            async read() { return okSnapshot(state); },
            async sell(id, { quantity }) {
                calls.push(id);
                assert.equal(quantity, 64);
                if (id === 'lapis_block' && lapisAttempts++ === 0) {
                    return {
                        success: true,
                        data: {
                            skipped: true,
                            reason: 'material-not-visible-in-sell-gui',
                            targetRefreshAttempted: true,
                            availableLogicalIds: ['iron_block']
                        }
                    };
                }
                state[id] -= quantity;
                return { success: true, data: { transitioned: true, semanticAcknowledged: true } };
            }
        }
    });
    const episodeId = 'cross-material:episode';
    const first = await service.startupTrimToReserve({ initialSnapshot: snap(state), batchId: 'cross-material', episodeId });
    assert.equal(first.success, false);
    assert.equal(first.error.code, 'B1_B5_PROTECTION_SELL_BLOCKED');
    assert.equal(first.error.resource, 'lapis_block');
    assert.deepEqual(calls, ['lapis_block', 'iron_block']);
    assert.equal(first.error.details.soldAmount.iron_block, 64);
    assert.equal(first.error.details.soldAmount.lapis_block, undefined);

    const resumed = await service.startupTrimToReserve({ batchId: 'cross-material', episodeId });
    assert.equal(resumed.success, true);
    assert.equal(resumed.data.completeForEpisode, true);
    assert.deepEqual(calls, ['lapis_block', 'iron_block', 'lapis_block']);
    assert.equal(resumed.data.soldAmount.iron_block, 64);
    assert.equal(resumed.data.soldAmount.lapis_block, 64);
});

test('transition-only sell follows the immutable 64 contract and treats concurrent inflow as next-batch input', async () => {
    const state = hardReserveState({ coal_block: 70 });
    let sellCalls = 0;
    let readCalls = 0;
    const service = makeService({
        storage: {
            config: { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: true, allowAll: false, blockOnly: true } },
            async closeSellGui() { return { success: true }; },
            async read() { readCalls += 1; return okSnapshot(state); },
            async sell() {
                sellCalls += 1;
                return { success: true, data: { skipped: false, transitioned: true, semanticAcknowledged: true, amountReliable: false, verification: { verified: false, requiresFreshStorage: true } } };
            }
        }
    });

    const result = await service.startupTrimToReserve({ initialSnapshot: snap(state), batchId: 'sale-noop', episodeId: 'sale-noop:episode' });
    assert.equal(result.success, true);
    assert.equal(result.data.completeForEpisode, true);
    assert.equal(result.data.soldAmount.coal_block, 64);
    assert.deepEqual(result.data.deferredNewInput, {});
    assert.equal(result.data.sellEvidence[0].source, 'sell-gui-contract-ack');
    assert.equal(sellCalls, 1);
    assert.equal(readCalls, 0, 'an acknowledged baseline sale must not trigger a final /kho read');
});

test('a raw transition without semantic Sell acknowledgement never advances the immutable cursor', async () => {
    const state = hardReserveState({ coal_block: 70 });
    const service = makeService({
        storage: {
            config: { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: false, allowAll: false, blockOnly: true } },
            async closeSellGui() { return { success: true }; },
            async read() { return okSnapshot(state); },
            async sell() { return { success: true, data: { skipped: false, transitioned: true, amountReliable: false } }; }
        }
    });
    const result = await service.startupTrimToReserve({ initialSnapshot: snap(state), batchId: 'raw-transition' });
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'B1_B5_PROTECTION_SELL_UNVERIFIED');
    assert.equal(result.error.details.nextActionIndex, 0);
    assert.equal(result.error.details.soldAmount.coal_block, undefined);
    assert.equal(result.error.details.sellEvidence[0].reason, 'sell-action-unacknowledged');
});

test('observed amount cannot interrupt an acknowledged immutable 64 action', async () => {
    const state = hardReserveState({ coal_block: 70 });
    let sellCalls = 0;
    const service = makeService({
        storage: {
            config: { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: true, allowAll: false, blockOnly: true } },
            async closeSellGui() { return { success: true }; },
            async read() { return okSnapshot(state); },
            async sell(id, { quantity }) {
                sellCalls += 1;
                assert.equal(quantity, 64);
                state[id] -= 32;
                return { success: true, data: { skipped: false, verifiedSoldQuantity: 32 } };
            }
        }
    });

    const result = await service.startupTrimToReserve({ initialSnapshot: snap(state), batchId: 'partial', episodeId: 'partial:episode' });
    assert.equal(result.success, true);
    assert.equal(sellCalls, 1);
    assert.equal(result.data.soldAmount.coal_block, 64);
    assert.equal(result.data.remainingInitialBudget.coal_block, 0);
    assert.deepEqual(result.data.deferredNewInput, {});
    assert.equal(result.data.sellEvidence[0].requestedQuantity, 64);
    assert.equal(result.data.sellEvidence[0].verifiedSoldQuantity, 64);
    assert.equal(result.data.sellEvidence[0].observedGuiQuantity, 32);
    assert.equal(result.data.sellEvidence[0].reason, null);
});

test('same-material inflow during every sell click never expands or interrupts the immutable baseline', async () => {
    const state = hardReserveState({ coal_block: 131 });
    let reads = 0;
    let sells = 0;
    const service = makeService({
        storage: {
            config: { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: false, allowAll: false, blockOnly: true } },
            async closeSellGui() { return { success: true }; },
            async read() { reads += 1; return okSnapshot(state); },
            async sell(id, { quantity }) {
                sells += 1;
                assert.equal(quantity, 64);
                state[id] -= quantity;
                state[id] += 40;
                return { success: true, data: { skipped: false, transitioned: true, semanticAcknowledged: true, amountReliable: false } };
            }
        }
    });
    const result = await service.startupTrimToReserve({
        initialSnapshot: snap(state), batchId: 'continuous-inflow', episodeId: 'continuous-inflow:episode'
    });
    assert.equal(result.success, true);
    assert.equal(result.data.clickBudget, 2);
    assert.equal(result.data.soldClicks, 2);
    assert.equal(result.data.acknowledgedActions, 2);
    assert.deepEqual(result.data.deferredNewInput, {});
    assert.equal(sells, 2);
    assert.equal(reads, 0, 'continuous inflow is left for the next batch without a post-sell /kho read');
});

test('pre-existing reserve shortage does not block craft after other immutable baseline sales finish', async () => {
    const state = hardReserveState({ iron_block: 10, coal_block: 131 });
    let sells = 0;
    const service = makeService({
        storage: {
            config: { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: false, allowAll: false, blockOnly: true } },
            async closeSellGui() { return { success: true }; },
            async read() { return okSnapshot(state); },
            async sell(id, { quantity }) {
                sells += 1;
                assert.equal(id, 'coal_block');
                assert.equal(quantity, 64);
                state[id] -= quantity;
                return { success: true, data: { transitioned: true, semanticAcknowledged: true } };
            }
        }
    });
    const episodeId = 'reserve-preflight:episode';
    const first = await service.startupTrimToReserve({ initialSnapshot: snap(state), batchId: 'reserve-preflight', episodeId });
    assert.equal(first.success, true);
    assert.equal(first.data.completeForEpisode, true);
    assert.equal(first.data.continuationRequired, false);
    assert.equal(first.data.waitingForReserveInput, undefined);
    assert.equal(first.data.actionsRemaining, 0);
    assert.deepEqual(first.data.reserveShortages, []);
    assert.equal(first.data.nextDelayMs, undefined);
    assert.equal(sells, 2);
});

test('post-sell storage amount cannot block craft after the immutable baseline is acknowledged', async () => {
    const state = hardReserveState({ coal_block: 70 });
    const service = makeService({
        storage: {
            config: { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: true, allowAll: false, blockOnly: true } },
            async closeSellGui() { return { success: true }; },
            async read() { return okSnapshot(state); },
            async sell(id, { quantity }) {
                assert.equal(id, 'coal_block');
                assert.equal(quantity, 64);
                // Server-side behavior depleted slightly more than the verified sale.
                state.coal_block = 2.64; // 2.64 * 9 / 16 = 1.485 B5
                return { success: true, data: { skipped: false, verifiedSoldQuantity: 64 } };
            }
        }
    });

    const result = await service.startupTrimToReserve({ initialSnapshot: snap(state), batchId: 'reserve-underrun', episodeId: 'reserve-underrun:episode' });
    assert.equal(result.success, true);
    assert.equal(result.data.completeForEpisode, true);
    assert.equal(result.data.remainingInitialBudget.coal_block, 0);
    assert.deepEqual(result.data.reserveViolations, []);
});

test('external depletion after an acknowledged baseline click is left to the next B5 batch', async () => {
    const state = hardReserveState({ coal_block: 70 });
    let sells = 0;
    const service = makeService({
        storage: {
            config: { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: false, allowAll: false, blockOnly: true } },
            async closeSellGui() { return { success: true }; },
            async read() { return okSnapshot(state); },
            async sell(id, { quantity }) {
                sells += 1;
                state[id] -= quantity + 1;
                return { success: true, data: { transitioned: true, semanticAcknowledged: true } };
            }
        }
    });
    const result = await service.startupTrimToReserve({ initialSnapshot: snap(state), batchId: 'external-depletion' });
    assert.equal(result.success, true);
    assert.equal(result.data.completeForEpisode, true);
    assert.deepEqual(result.data.finalVerificationIssues, []);
    assert.equal(sells, 1);
});

test('sell disabled with a complete 64-block baseline surplus blocks mandatory B5 protection instead of skipping success', async () => {
    const state = hardReserveState({ coal_block: 130 });
    let sells = 0;
    const service = makeService({
        storage: {
            config: { sell: { enabled: false, reserveCoverage: 1.5, allowSingle: true, allowAll: false, blockOnly: true } },
            async closeSellGui() { return { success: true }; },
            async read() { return okSnapshot(state); },
            async sell() { sells += 1; return { success: true, data: {} }; }
        }
    });
    const result = await service.startupTrimToReserve({ initialSnapshot: snap(state), batchId: 'disabled-surplus' });
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'B1_B5_PROTECTION_SELL_DISABLED');
    assert.equal(result.error.details.completeForEpisode, false);
    assert.equal(sells, 0);
});

test('sell disabled with no safe baseline surplus completes without a final /kho verification', async () => {
    const state = hardReserveState();
    let reads = 0;
    let sells = 0;
    const service = makeService({
        storage: {
            config: { sell: { enabled: false, reserveCoverage: 1.5, allowSingle: true, allowAll: false, blockOnly: true } },
            async closeSellGui() { return { success: true }; },
            async read() { reads += 1; return okSnapshot(state); },
            async sell() { sells += 1; return { success: true, data: {} }; }
        }
    });
    const result = await service.startupTrimToReserve({ initialSnapshot: snap(state), batchId: 'disabled-no-surplus' });
    assert.equal(result.success, true);
    assert.equal(result.data.completeForEpisode, true);
    assert.equal(sells, 0);
    assert.equal(reads, 0, 'no post-sell /kho verification is performed');
    for (const family of Object.values(result.data.finalCoverage)) assert.ok(family.coverage >= 1.5);
});

test('B5 smelting preflight blocks before side effects when either required recipe is missing', async () => {
    for (const configured of [['raw_iron_to_iron'], ['raw_gold_to_gold']]) {
        let reads = 0;
        let smelts = 0;
        const service = makeService({
            conversion: conversionConfig({ smeltingRecipeIds: configured }),
            storage: { async closeSellGui() { throw new Error('must not touch GUI'); }, async read() { reads += 1; return okSnapshot(hardReserveState()); } },
            smelting: { async smelt() { smelts += 1; return { success: true }; } }
        });
        const result = await service.protectForB5Batch({ batchId: 'smelt-preflight' });
        assert.equal(result.success, false);
        assert.equal(result.error.code, 'B1_B5_PROTECTION_SMELT_CONFIG_INVALID');
        assert.equal(reads, 0);
        assert.equal(smelts, 0);
    }
});

test('B5 smelting runtime canonicalizes reversed/extended config to iron then gold only', async () => {
    const state = hardReserveState({ raw_iron: 1, raw_gold: 1, iron_block: 11, gold_block: 11 });
    const smelts = [];
    const service = makeService({
        conversion: conversionConfig({ smeltingRecipeIds: ['raw_gold_to_gold', 'cobblestone_to_stone', 'raw_iron_to_iron'] }),
        storage: {
            config: { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: true, allowAll: false, blockOnly: true } },
            async closeSellGui() { return { success: true }; },
            async read() { return okSnapshot(state); },
            async sell(id, { quantity }) { state[id] -= Number(quantity); return { success: true, data: { verifiedSoldQuantity: Number(quantity) } }; }
        },
        smelting: {
            async smelt(id) {
                smelts.push(id);
                if (id === 'raw_iron_to_iron') { state.raw_iron = 0; state.iron_ingot = Number(state.iron_ingot || 0) + 1; }
                if (id === 'raw_gold_to_gold') { state.raw_gold = 0; state.gold_ingot = Number(state.gold_ingot || 0) + 1; }
                return { success: true, data: { skipped: false } };
            }
        },
        minerals: { async toBlocks() { return { success: true, data: { skipped: true, reason: 'below-block-ratio' } }; } }
    });
    const result = await service.protectForB5Batch({ batchId: 'ordered-smelt' });
    assert.equal(result.success, true);
    assert.deepEqual(smelts, ['raw_iron_to_iron', 'raw_gold_to_gold']);
});

test('real KhoSellOperation transition-only result advances from semantic acknowledgement and checkpoints once', async () => {
    const state = hardReserveState({ coal_block: 70 });
    let current = null;
    let fullKhoReads = 0;
    const makeSession = () => ({
        window: { id: 1, title: 'Kho', slots: [] },
        source: null,
        active: true,
        setSource(source) { this.source = source; }
    });
    const sellConfig = {
        guiTimeoutMs: 100,
        sell: {
            enabled: true, reserveCoverage: 1.5, allowSingle: true, allowAll: false, blockOnly: true,
            commandKey: 'storageSell', resultDelayMs: 0, openSettleMs: 0, closeSettleMs: 0,
            openPollMs: 1, openAttempts: 1,
            itemAliases: { coal_block: 'COAL_BLOCK' }
        }
    };
    const operation = new KhoSellOperation({
        commandService: { async send() { current = makeSession(); return { success: true }; } },
        guiManager: {
            current() { return current; },
            syncCurrentWindow() { return current; },
            markCurrent(source) { current?.setSource(source); return current; },
            async closeCurrentWindow() { current = null; },
            async clickAndWaitForTransition(_slot, options) {
                state.coal_block -= options.button === 1 ? 64 : 1;
                return current;
            },
            describeCurrent() { return current ? { windowId: 1, title: 'Kho' } : null; }
        },
        reader: {
            read() {
                return {
                    entries: {
                        coal_block: {
                            logicalId: 'coal_block', slot: 12,
                            amount: null, amountReliable: false
                        }
                    }
                };
            }
        },
        config: sellConfig
    });
    const service = makeService({
        storage: {
            config: sellConfig,
            async closeSellGui() { await operation.close(); return { success: true }; },
            async read() { fullKhoReads += 1; return okSnapshot(state); },
            async sell(id, options) {
                const data = await operation.execute(id, options);
                assert.equal(data.verification.verified, false);
                assert.equal(data.verification.verifiedSoldQuantity, null);
                assert.equal(data.verifiedSoldQuantity, null);
                assert.equal(data.verification.requiresFreshStorage, true);
                return { success: true, data };
            }
        }
    });

    const result = await service.startupTrimToReserve({
        initialSnapshot: snap(state), batchId: 'real-sell-result', episodeId: 'real-sell-result:episode'
    });
    assert.equal(result.success, true);
    assert.equal(fullKhoReads, 0, 'transition-only result must not force a final /kho read');
    assert.ok(result.data.sellEvidence.every(entry => entry.source === 'sell-gui-contract-ack'));
    assert.ok(result.data.sellEvidence.every(entry => entry.exactRequested === true));
});

test('non-number compatibility amounts remain diagnostics and never interrupt a transitioned 64 action', async () => {
    for (const value of [null, undefined, '', '64', false]) {
        const state = hardReserveState({ coal_block: 70 });
        let reads = 0;
        const service = makeService({
            storage: {
                config: { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: true, allowAll: false, blockOnly: true } },
                async closeSellGui() { return { success: true }; },
                async read() { reads += 1; return okSnapshot(state); },
                async sell() {
                    return {
                        success: true,
                        data: {
                            skipped: false,
                            transitioned: true,
                            semanticAcknowledged: true,
                            verifiedSoldQuantity: value,
                            verification: { verified: false, verifiedSoldQuantity: value, requiresFreshStorage: true }
                        }
                    };
                }
            }
        });
        const result = await service.startupTrimToReserve({ initialSnapshot: snap(state), batchId: `strict-${String(value)}` });
        assert.equal(result.success, true);
        assert.equal(result.data.soldAmount.coal_block, 64);
        assert.equal(result.data.sellEvidence[0].source, 'sell-gui-contract-ack');
        assert.equal(reads, 0, `no final /kho checkpoint is allowed for non-number evidence ${String(value)}`);
    }
});

test('protection evidence key ignores unrelated inflow/capacity but changes for the blocker material family', () => {
    let latestState = {
        success: true,
        data: {
            items: { coal: 10, coal_block: 2, diamond: 3, diamond_block: 1 },
            capacity: { used: 100, limit: 800000 }
        }
    };
    const service = makeService({
        storage: {
            latest() { return latestState; }
        }
    });
    const blocker = { material: 'coal', reason: 'candidate-unavailable' };
    const initial = service.protectionEvidenceKey(blocker);

    latestState = {
        success: true,
        data: {
            items: { coal: 10, coal_block: 2, diamond: 9999, diamond_block: 999 },
            capacity: { used: 500000, limit: 800000 }
        }
    };
    assert.equal(service.protectionEvidenceKey(blocker), initial, 'unrelated family inflow/global capacity must not grant a retry');

    latestState = {
        success: true,
        data: {
            items: { coal: 11, coal_block: 2, diamond: 9999, diamond_block: 999 },
            capacity: { used: 500001, limit: 800000 }
        }
    };
    assert.notEqual(service.protectionEvidenceKey(blocker), initial, 'evidence change in the blocked family must be observable');
    assert.equal(service.protectionEvidenceKey({ reason: 'unknown', material: 'not-a-family' }), null, 'unresolved blocker must not hash the whole storage');
});
