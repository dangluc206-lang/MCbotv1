'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B5CraftModeService = require('../../../src/modes/b5-craft/B5CraftModeService');
const ModeCatalog = require('../../../src/modes/ModeCatalog');
const ModeCoordinator = require('../../../src/modes/ModeCoordinator');
const ModeContext = require('../../../src/modes/ModeContext');
const CapabilityRegistry = require('../../../src/core/registry/CapabilityRegistry');
const EventBus = require('../../../src/core/EventBus');
const Result = require('../../../src/shared/result/Result');
const FlowError = require('../../../src/shared/errors/FlowError');
const B5AutomationService = require('../../../src/server-features/crafting/B5AutomationService');
const OperationManager = require('../../../src/operations/OperationManager');
const OperationQueue = require('../../../src/operations/OperationQueue');
const OperationLockPolicy = require('../../../src/operations/OperationLockPolicy');
const OperationTimeoutPolicy = require('../../../src/operations/OperationTimeoutPolicy');

async function waitUntil(predicate, timeoutMs = 500) {
    const startedAt = Date.now();
    while (!predicate()) {
        if (Date.now() - startedAt >= timeoutMs) throw new Error('Timed out waiting for condition');
        await new Promise(resolve => setTimeout(resolve, 2));
    }
}

function harness({ enabled = true, generationRef = { value: 7 }, craftImplementation = null, planningImplementation = null, protectionImplementation = null, protectionEvidenceKeyImplementation = null, stability = null, reconciliation = null, logger = null, failurePolicy = null, failurePublisher = null } = {}) {
    const calls = { home: 0, protect: 0, protectOptions: [], postSmelt: 0, operationRuns: [], inspect: 0, craft: 0, craftOptions: [], skyDemand: [], skyRelease: [], sequence: [] };
    const catalog = new ModeCatalog([{ id: 'b5-craft', serviceName: 'b5CraftMode', label: 'Chế B5 thuần' }]).seal();
    const caps = new CapabilityRegistry({ botId: 'bot-01' }).seal();
    const eventBus = new EventBus();
    let operationSequence = 0;
    const operationManager = {
        async run(operation, options = {}) {
            calls.operationRuns.push({ operationName: operation?.name || null, ...options });
            const operationId = `bot-01:test-protection:${++operationSequence}`;
            const context = {
                botId: 'bot-01',
                operationId,
                rootOperationId: operationId,
                correlationId: options.correlationId || operationId,
                connectionGeneration: options.connectionGeneration ?? generationRef.value,
                cancellation: { token: options.cancellationToken },
                metadata: options.metadata || null
            };
            return operation.executor(context);
        }
    };
    const modeContext = new ModeContext({
        botId: 'bot-01',
        botContext: { has: () => true, getGeneration: () => generationRef.value },
        capabilityRegistry: caps,
        eventBus,
        operationManager
    });
    const coordinator = new ModeCoordinator({ botId: 'bot-01' });
    const island = { async goHome() { calls.home += 1; return { success: true }; } };
    const b1Materials = {
        async protectForB5Batch(options) {
            calls.protect += 1;
            calls.protectOptions.push(options);
            calls.sequence.push('protect');
            if (protectionImplementation) return protectionImplementation(options, calls);
            return { success: true, data: { protected: true } };
        },
        async preprocessForCraft() {
            calls.postSmelt += 1;
            calls.sequence.push('post-smelt');
            return { success: true, data: { actions: [] } };
        },
        protectionEvidenceKey(blocker) {
            return protectionEvidenceKeyImplementation ? protectionEvidenceKeyImplementation(blocker, calls) : null;
        },
        status() { return {}; }
    };
    const b5Planning = { async inspectAdditionalFresh(...args) { calls.inspect += 1; return planningImplementation ? planningImplementation(...args) : { success: true, data: {} }; } };
    const b5Automation = {
        async runNext(options) {
            calls.craft += 1;
            calls.craftOptions.push(options);
            calls.sequence.push('craft');
            if (craftImplementation) return craftImplementation(options, calls);
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false, blockingReasons: [{ status: 'waiting', reason: 'waiting-for-complete-b2-batch', baseId: 'diamond' }] } };
        },
        status() { return {}; }
    };
    const mode = new B5CraftModeService({
        botId: 'bot-01', modeContext, modeCoordinator: coordinator, catalog,
        island, skyTarget: 'sky1', skyblockReadiness: { isGenerationReady: () => true, requireTarget(target, options) { calls.skyDemand.push({ target, options }); }, releaseTarget(owner) { calls.skyRelease.push(owner); } }, b1Materials, b5Planning, b5Automation,
        failurePolicy, failurePublisher,
        logger,
        config: {
            enabled, teleportHomeOnEnable: true, autoResumeOnReconnect: true,
            pollIntervalMs: 5, disconnectedPollMs: 5, errorRetryMs: 5,
            errorRetryMaxMs: 20, craftLoopDelayMs: 5, postB5CooldownMs: 5,
            stability: stability || { noProgressBackoffEnabled: true, noProgressBaseDelayMs: 5, noProgressMaxDelayMs: 20, sameBlockerThreshold: 2, logEveryNthRepeat: 3 },
            reconciliation: reconciliation || { maxFreshReads: 2, retryMs: 2, unresolvedPollMs: 5, allowRetryAfterVerifiedNoEffect: true }
        }
    });
    return { mode, coordinator, calls };
}

test('B5 craft mode demands its configured Sky target, protects storage first, then crafts with unbounded B1 decompression', async () => {
    const { mode, coordinator, calls } = harness();
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await new Promise(resolve => setTimeout(resolve, 18));
    await mode.disable('test complete');
    assert.equal(calls.home, 1);
    assert.equal(calls.protect, 1);
    assert.equal(calls.protectOptions[0].trigger, 'explicit-enable');
    assert.match(calls.protectOptions[0].batchId, /^bot-01:b5-batch:/);
    assert.ok(calls.craft >= 1);
    assert.equal(calls.sequence[0], 'protect');
    assert.ok(calls.craftOptions.every(options => options.freshInspection === true));
    assert.ok(calls.craftOptions.every(options => options.decompressionPolicy === 'unbounded'));
    assert.equal(calls.inspect, 0, 'runNext owns the fresh planning snapshot');
    assert.ok(calls.skyDemand.some(call => call.target === 'sky1'));
    assert.deepEqual(calls.skyRelease, ['b5-craft']);
    assert.equal(mode.status().details.policy.movement, false);
    assert.equal(mode.status().details.policy.smelting, true);
    assert.equal(mode.publicConfig().storageProtection, undefined);
});

test('B5 storage protection boundary disables only its root execution deadline', async () => {
    const { mode, coordinator, calls } = harness();
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.protect >= 1, 200);
    await mode.disable('test complete');

    const protectionRun = calls.operationRuns.find(run => run.operationName === 'B5StorageProtectionBoundary');
    assert.ok(protectionRun);
    assert.equal(protectionRun.timeoutMs, null);
});

test('B5 craft mode has no per-mode smelting/protection toggle; storage protection is mandatory at the batch boundary', async () => {
    const { mode, coordinator, calls } = harness();
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await new Promise(resolve => setTimeout(resolve, 14));
    await mode.disable('test complete');
    assert.ok(calls.protect >= 1);
    assert.equal(mode.publicConfig().storageProtection, undefined);
    assert.equal(mode.status().details.policy.storageProtection, true);
    assert.equal(mode.status().details.policy.smelting, true);
});

test('B5 craft mode always runs one storage-protection boundary before a campaign instead of pressure-gating it', async () => {
    const { mode, coordinator, calls } = harness();
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await new Promise(resolve => setTimeout(resolve, 18));
    await mode.disable('test complete');
    assert.equal(calls.protect, 1, 'waiting-for-material loops stay inside the same protected campaign');
    assert.ok(calls.craft >= 1);
});

test('B5 craft mode cannot start while disabled in configuration', async () => {
    const { mode, coordinator, calls } = harness({ enabled: false });
    await coordinator.initialize(); await coordinator.start();
    const result = await mode.enable();
    assert.equal(result.success, false);
    assert.equal(result.status, 'NOT_READY');
    assert.equal(calls.home, 0);
    assert.equal(calls.craft, 0);
});


test('B5 craft mode does not run a pressure gate or sell again between protection and crafting', async () => {
    const { mode, coordinator, calls } = harness();
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await new Promise(resolve => setTimeout(resolve, 18));
    await mode.disable('test complete');
    assert.equal(calls.protect, 1);
    assert.ok(calls.craft >= 1);
    assert.deepEqual(calls.sequence.slice(0, 2), ['protect', 'craft']);
});

test('B5 craft mode exposes no legacy high-water diagnostic gate in its public configuration', async () => {
    const { mode, coordinator, calls } = harness();
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await new Promise(resolve => setTimeout(resolve, 14));
    await mode.disable('test complete');
    const cfg = mode.publicConfig();
    assert.equal(cfg.requireReliefBeforeCraft, undefined);
    assert.equal(cfg.b1NormalizeIntervalMs, undefined);
    assert.equal(cfg.waitForSkyblockReady, undefined);
    assert.equal(cfg.skyblockReadyTimeoutMs, undefined);
    assert.ok(calls.craft >= 1);
});

test('B5 craft mode discards stale cycle results when connection generation changes during crafting', async () => {
    const generationRef = { value: 7 };
    const { mode, coordinator, calls } = harness({
        generationRef,
        craftImplementation: async () => {
            generationRef.value += 1;
            return { success: true, data: { completedNewB5: true, completedAmount: 99, productive: true } };
        }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await new Promise(resolve => setTimeout(resolve, 15));
    await mode.disable('test complete');
    assert.ok(calls.craft >= 1);
    assert.equal(mode.status().details.completedB5, 0, 'stale generation must not count a B5 completion');
    assert.ok(mode.status().details.staleGenerationAborts >= 1);
});

test('B5 craft mode backs off repeated identical blockers instead of hammering GUI every poll', async () => {
    const { mode, coordinator } = harness({ pressure: false, stability: { noProgressBackoffEnabled: true, noProgressBaseDelayMs: 12, noProgressMaxDelayMs: 30, sameBlockerThreshold: 2, logEveryNthRepeat: 3 } });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await new Promise(resolve => setTimeout(resolve, 28));
    const status = mode.status();
    await mode.disable('test complete');
    assert.ok(status.details.noProgressStreak >= 2);
    assert.ok(status.details.lastCycleDelayMs >= 12);
});

test('B5 craft mode quarantines an uncertain mutation with side-effect evidence instead of re-clicking', async () => {
    let craftCalls = 0;
    const uncertainError = Object.assign(new Error('uncertain'), {
        code: 'CRAFTING_OUTCOME_UNCERTAIN',
        details: {
            recipeId: 'super_cobblestone_block',
            outputId: 'super_cobblestone_block',
            amount: 'ALL',
            expectedDelta: 1,
            before: 0,
            reconciliationBaseline: {
                outputCountBefore: 0,
                inputCountsBefore: { super_cobblestone: 2008 }
            },
            inputEvidence: [{ inputId: 'super_cobblestone', expected: 16 }],
            outcome: {
                requiresReconciliation: true,
                observedSideEffect: true,
                unexpectedIdentityDeltas: [{ identity: 'MMOITEMS_ITEM_ID:SIEUDACUOI', delta: 2 }]
            }
        }
    });
    const { mode, coordinator, calls } = harness({
        craftImplementation: async () => {
            craftCalls += 1;
            return { success: false, status: 'VERIFICATION_FAILED', message: uncertainError.message, error: uncertainError };
        },
        planningImplementation: async () => ({
            success: true,
            data: { inventoryTotals: { super_cobblestone: 2010, super_cobblestone_block: 0 } }
        }),
        reconciliation: { maxFreshReads: 2, retryMs: 2, unresolvedPollMs: 4, allowRetryAfterVerifiedNoEffect: true }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await new Promise(resolve => setTimeout(resolve, 28));
    const status = mode.status();
    await mode.disable('test complete');
    assert.equal(craftCalls, 1, 'uncertain mutation must not be clicked again while unresolved');
    assert.ok(calls.inspect >= 2, 'fresh planning reads must be used for reconciliation');
    assert.equal(status.details.pendingCraftReconciliation?.outputId, 'super_cobblestone_block');
    assert.equal(status.details.pendingCraftReconciliation?.observedSideEffect, true);
    assert.ok(status.details.unresolvedReconciliations >= 1);
});

test('B5 craft mode may re-plan only after repeated fresh reads prove observable inputs and output unchanged', async () => {
    let craftCalls = 0;
    const { mode, coordinator, calls } = harness({
        craftImplementation: async () => {
            craftCalls += 1;
            if (craftCalls === 1) {
                const error = Object.assign(new Error('uncertain-no-effect'), {
                    code: 'CRAFTING_OUTCOME_UNCERTAIN',
                    details: {
                        recipeId: 'x', outputId: 'x', amount: 1, expectedDelta: 1,
                        reconciliationBaseline: { outputCountBefore: 0, inputCountsBefore: { input: 64 } },
                        inputEvidence: [{ inputId: 'input', expected: 16 }],
                        outcome: { requiresReconciliation: true, observedSideEffect: false, unexpectedIdentityDeltas: [] }
                    }
                });
                return { success: false, status: 'VERIFICATION_FAILED', message: error.message, error };
            }
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false } };
        },
        planningImplementation: async () => ({ success: true, data: { inventoryTotals: { input: 64, x: 0 } } }),
        reconciliation: { maxFreshReads: 2, retryMs: 2, unresolvedPollMs: 5, allowRetryAfterVerifiedNoEffect: true }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.inspect >= 2 && craftCalls >= 2, 500);
    await mode.disable('test complete');
    assert.ok(calls.inspect >= 2);
    assert.ok(craftCalls >= 2, 're-plan is allowed only after the no-effect reconciliation barrier completes');
});

test('B5 craft mode never re-clicks when a post-click outcome has no observable input baseline', async () => {
    let craftCalls = 0;
    const { mode, coordinator, calls } = harness({
        craftImplementation: async () => {
            craftCalls += 1;
            const error = Object.assign(new Error('uncertain-unobservable-input'), {
                code: 'CRAFTING_OUTCOME_UNCERTAIN',
                details: {
                    recipeId: 'refined_coal', outputId: 'refined_coal', amount: 'ALL', expectedDelta: 1,
                    reconciliationBaseline: { outputCountBefore: 0, inputCountsBefore: { coal: 0 } },
                    inputEvidence: [{ inputId: 'coal', expected: 32 }],
                    outcome: { requiresReconciliation: true, observedSideEffect: false, unexpectedIdentityDeltas: [] }
                }
            });
            return { success: false, status: 'VERIFICATION_FAILED', message: error.message, error };
        },
        planningImplementation: async () => ({ success: true, data: { inventoryTotals: { refined_coal: 0, coal: 0 } } }),
        reconciliation: { maxFreshReads: 2, retryMs: 2, unresolvedPollMs: 4, allowRetryAfterVerifiedNoEffect: true }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await new Promise(resolve => setTimeout(resolve, 28));
    const status = mode.status();
    await mode.disable('test complete');
    assert.equal(craftCalls, 1, 'a storage-sourced/unobservable input must never be blindly re-clicked');
    assert.ok(calls.inspect >= 2);
    assert.equal(status.details.pendingCraftReconciliation?.outputId, 'refined_coal');
    assert.equal(status.details.pendingCraftReconciliation?.noEffectProofPasses, 0);
    assert.equal(status.details.waitingReason, 'craft-inputs-not-observable');
});

test('B5 craft reconciliation compares storage-backed input against fresh /kho instead of inventory lookalikes', async () => {
    let craftCalls = 0;
    const { mode, coordinator, calls } = harness({
        craftImplementation: async () => {
            craftCalls += 1;
            const error = Object.assign(new Error('uncertain-storage-side-effect'), {
                code: 'CRAFTING_OUTCOME_UNCERTAIN',
                details: {
                    recipeId: 'refined_coal', outputId: 'refined_coal', amount: 'ALL', expectedDelta: 1,
                    reconciliationBaseline: {
                        output: { source: 'inventory', count: 150 },
                        outputCountBefore: 150,
                        inputs: { coal: { source: 'storage', count: 2308 } },
                        // This legacy field intentionally contains the wrong
                        // inventory-looking value from the historical bug.
                        inputCountsBefore: { coal: 150 }
                    },
                    inputEvidence: [{ inputId: 'coal', expected: 16, source: 'storage', ignored: true, reason: 'input-source:storage' }],
                    outcome: { requiresReconciliation: true, observedSideEffect: false, unexpectedIdentityDeltas: [] }
                }
            });
            return { success: false, status: 'VERIFICATION_FAILED', message: error.message, error };
        },
        planningImplementation: async () => ({
            success: true,
            data: {
                inventoryTotals: { refined_coal: 150, coal: 150 },
                storage: { items: { coal: 0 } },
                personalVault: { totals: {} }
            }
        }),
        reconciliation: { maxFreshReads: 2, retryMs: 2, unresolvedPollMs: 4, allowRetryAfterVerifiedNoEffect: true }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await new Promise(resolve => setTimeout(resolve, 30));
    const status = mode.status();
    await mode.disable('test complete');
    assert.equal(craftCalls, 1, 'observed /kho consumption must quarantine the identical ALL click');
    assert.ok(calls.inspect >= 2);
    assert.equal(status.details.pendingCraftReconciliation?.observedSideEffect, true);
    assert.equal(status.details.pendingCraftReconciliation?.lastObserved?.inputDeltas?.coal?.source, 'storage');
    assert.equal(status.details.pendingCraftReconciliation?.lastObserved?.inputDeltas?.coal?.before, 2308);
    assert.equal(status.details.pendingCraftReconciliation?.lastObserved?.inputDeltas?.coal?.now, 0);
    assert.equal(status.details.pendingCraftReconciliation?.lastObserved?.inputDeltas?.coal?.consumed, 2308);
});

test('B5 craft reconciliation may clear a storage-backed no-effect only after repeated fresh /kho reads stay unchanged', async () => {
    let craftCalls = 0;
    const { mode, coordinator } = harness({
        craftImplementation: async () => {
            craftCalls += 1;
            if (craftCalls === 1) {
                const error = Object.assign(new Error('uncertain-storage-no-effect'), {
                    code: 'CRAFTING_OUTCOME_UNCERTAIN',
                    details: {
                        recipeId: 'refined_coal', outputId: 'refined_coal', amount: 'ALL', expectedDelta: 1,
                        reconciliationBaseline: {
                            output: { source: 'inventory', count: 150 },
                            inputs: { coal: { source: 'storage', count: 2308 } }
                        },
                        inputEvidence: [{ inputId: 'coal', expected: 16, source: 'storage', ignored: true, reason: 'input-source:storage' }],
                        outcome: { requiresReconciliation: true, observedSideEffect: false, unexpectedIdentityDeltas: [] }
                    }
                });
                return { success: false, status: 'VERIFICATION_FAILED', message: error.message, error };
            }
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false } };
        },
        planningImplementation: async () => ({
            success: true,
            data: {
                inventoryTotals: { refined_coal: 150 },
                storage: { items: { coal: 2308 } },
                personalVault: { totals: {} }
            }
        }),
        reconciliation: { maxFreshReads: 2, retryMs: 2, unresolvedPollMs: 5, allowRetryAfterVerifiedNoEffect: true }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await new Promise(resolve => setTimeout(resolve, 32));
    await mode.disable('test complete');
    assert.ok(craftCalls >= 2, 'only repeated unchanged /kho baselines may release the transaction quarantine');
});


test('B5 craft mode runs storage protection again before the campaign after a completed B5 batch', async () => {
    let completed = false;
    const { mode, coordinator, calls } = harness({
        craftImplementation: () => {
            if (!completed) {
                completed = true;
                return { success: true, data: { complete: true, completedNewB5: true, completedAmount: 1, productive: true, blockingReasons: [] } };
            }
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false, blockingReasons: [{ status: 'waiting', reason: 'materials' }] } };
        }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await new Promise(resolve => setTimeout(resolve, 34));
    await mode.disable('test complete');
    assert.ok(calls.protect >= 2, 'every campaign after B5 completion must begin with storage protection');
    assert.ok(calls.craft >= 2);
    assert.equal(calls.postSmelt, 1, 'completed B5 must trigger one immediate iron/gold smelting pass');
    const completedCraft = calls.sequence.indexOf('craft');
    const postSmelt = calls.sequence.indexOf('post-smelt');
    const nextProtection = calls.sequence.indexOf('protect', postSmelt + 1);
    assert.ok(completedCraft < postSmelt && postSmelt < nextProtection,
        `expected craft -> post-smelt -> next protection, got ${calls.sequence.join(' -> ')}`);
});

test('B5 craft mode keeps productive partial B2/B3 progress inside the same protected campaign', async () => {
    const { mode, coordinator, calls } = harness({
        craftImplementation: async () => ({
            success: true,
            data: { complete: false, waitingForMaterials: true, productive: true, blockingReasons: [{ status: 'waiting', reason: 'waiting-for-next-b3-batch', baseId: 'coal' }] }
        })
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await new Promise(resolve => setTimeout(resolve, 28));
    const status = mode.status();
    await mode.disable('test complete');
    assert.ok(calls.craft >= 2);
    assert.equal(calls.protect, 1, 'partial productive work must not restart storage protection mid-campaign');
    assert.equal(status.details.noProgressStreak, 0);
});

test('B5 craft mode does not rerun storage protection merely because materials remain idle', async () => {
    const { mode, coordinator, calls } = harness({
        stability: { noProgressBackoffEnabled: false, noProgressBaseDelayMs: 3, noProgressMaxDelayMs: 6, sameBlockerThreshold: 2, logEveryNthRepeat: 3 },
        craftImplementation: async () => ({ success: true, data: { complete: false, waitingForMaterials: true, productive: false, blockingReasons: [{ status: 'waiting', reason: 'waiting-for-complete-b2-batch', baseId: 'diamond' }] } })
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await new Promise(resolve => setTimeout(resolve, 30));
    await mode.disable('test complete');
    assert.ok(calls.craft >= 2);
    assert.equal(calls.protect, 1, 'storage protection belongs to batch boundaries, not idle timers');
});

test('B5 craft mode does not rerun storage protection for PV2 backpressure', async () => {
    const { mode, coordinator, calls } = harness({
        craftImplementation: async () => ({ success: true, data: { complete: false, waitingForMaterials: true, productive: false, pv2Backpressure: { hardBlocked: true }, blockingReasons: [{ status: 'waiting', reason: 'pv2-hard-blocked' }] } })
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await new Promise(resolve => setTimeout(resolve, 24));
    const status = mode.status();
    await mode.disable('test complete');
    assert.equal(calls.protect, 1);
    assert.equal(status.details.waitingReason, 'pv2-backpressure');
});

test('B5 reconciliation does not make one transient storage decrease sticky forever when fresh material supersedes the baseline', async () => {
    let craftCalls = 0;
    let inspectCalls = 0;
    const { mode, coordinator, calls } = harness({
        craftImplementation: async () => {
            craftCalls += 1;
            if (craftCalls === 1) {
                const error = Object.assign(new Error('uncertain-storage-transient'), {
                    code: 'CRAFTING_OUTCOME_UNCERTAIN',
                    details: {
                        recipeId: 'refined_coal', outputId: 'refined_coal', amount: 'ALL', expectedDelta: 1,
                        reconciliationBaseline: {
                            output: { source: 'inventory', count: 1 },
                            inputs: { coal: { source: 'storage', count: 188 } }
                        },
                        inputEvidence: [{ inputId: 'coal', expected: 16, source: 'storage', ignored: true, reason: 'input-source:storage' }],
                        outcome: { requiresReconciliation: true, observedSideEffect: false, unexpectedIdentityDeltas: [] }
                    }
                });
                return { success: false, status: 'VERIFICATION_FAILED', message: error.message, error };
            }
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false } };
        },
        planningImplementation: async () => {
            inspectCalls += 1;
            const coal = inspectCalls === 1 ? 100 : 14943;
            return {
                success: true,
                data: {
                    inventoryTotals: { refined_coal: 1 },
                    storage: { items: { coal } },
                    personalVault: { totals: {} }
                }
            };
        },
        reconciliation: { maxFreshReads: 2, retryMs: 2, unresolvedPollMs: 5, allowRetryAfterVerifiedNoEffect: true }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await new Promise(resolve => setTimeout(resolve, 45));
    await mode.disable('test complete');
    assert.ok(calls.inspect >= 3, 'reconciliation should require repeated superseding fresh reads');
    assert.ok(craftCalls >= 2, 'fresh planner must resume after the transient lower storage read is disproved');
});


test('B5 craft reconnect after a completed protection gate keeps the same batch protected', async () => {
    const generationRef = { value: 7 };
    const { mode, coordinator, calls } = harness({ generationRef });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.protect === 1 && calls.craft >= 1);
    const protectedBatch = calls.protectOptions[0].batchId;
    generationRef.value = 8;
    await new Promise(resolve => setTimeout(resolve, 30));
    const status = mode.status();
    await mode.disable('test complete');
    assert.equal(calls.protect, 1, 'reconnect must not create another protection episode for the same batch');
    assert.equal(status.details.batchId, protectedBatch);
    assert.equal(status.details.batchProtectionCompleted, true);
});

test('B5 craft discards a stale protection callback and retries the pending gate on the new generation', async () => {
    const generationRef = { value: 7 };
    const observed = [];
    const { mode, coordinator, calls } = harness({
        generationRef,
        protectionImplementation: async options => {
            observed.push({ batchId: options.batchId, trigger: options.trigger, generation: options.expectedGeneration });
            if (observed.length === 1) generationRef.value = 8;
            return { success: true, data: { completeForEpisode: true } };
        }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.protect >= 2 && calls.craft >= 1);
    const status = mode.status();
    await mode.disable('test complete');
    assert.equal(observed[0].batchId, observed[1].batchId, 'generation change must not arm a new business batch');
    assert.equal(observed[0].trigger, 'explicit-enable');
    assert.equal(observed[1].trigger, 'explicit-enable');
    assert.deepEqual(observed.slice(0, 2).map(item => item.generation), [7, 8]);
    assert.deepEqual(calls.sequence.slice(0, 3), ['protect', 'protect', 'craft']);
    assert.ok(status.details.staleGenerationAborts >= 1);
    assert.equal(status.details.batchProtectionCompleted, true);
});

test('B5 craft pause and resume do not create a storage-protection boundary', async () => {
    const { mode, coordinator, calls } = harness();
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.protect === 1 && calls.craft >= 1);
    const batchId = calls.protectOptions[0].batchId;
    await mode.pause('operator');
    await new Promise(resolve => setTimeout(resolve, 8));
    await mode.resume();
    await new Promise(resolve => setTimeout(resolve, 25));
    const status = mode.status();
    await mode.disable('test complete');
    assert.equal(calls.protect, 1);
    assert.equal(status.details.batchId, batchId);
});

test('B5 craft arms exactly one post-B5 protection boundary before the next batch', async () => {
    let completed = false;
    const { mode, coordinator, calls } = harness({
        craftImplementation: async () => {
            if (!completed) {
                completed = true;
                return { success: true, data: { completedNewB5: true, completedAmount: 1, productive: true } };
            }
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false } };
        }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.protect >= 2 && calls.craft >= 2);
    await mode.disable('test complete');
    assert.equal(calls.protect, 2);
    assert.equal(calls.protectOptions[0].trigger, 'explicit-enable');
    assert.equal(calls.protectOptions[1].trigger, 'post-b5-complete');
    assert.notEqual(calls.protectOptions[0].batchId, calls.protectOptions[1].batchId);
});

function stableProtectionBlocker(reason = 'candidate-unavailable') {
    const error = Object.assign(new Error(`storage protection blocked: ${reason}`), {
        code: 'B1_B5_PROTECTION_SELL_BLOCKED',
        step: 'sell-baseline',
        details: { blocker: { reason, material: 'coal', sellId: 'coal_block' } }
    });
    return { success: false, status: 'NOT_READY', message: error.message, error };
}

test('B5 protection caps repeated identical blocker side effects across mode loop cycles', async () => {
    const { mode, coordinator, calls } = harness({
        protectionImplementation: async () => stableProtectionBlocker()
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.protect >= 3, 300);
    await new Promise(resolve => setTimeout(resolve, 45));
    const status = mode.status();
    const countAfterBlocked = calls.protect;
    await new Promise(resolve => setTimeout(resolve, 35));
    await mode.disable('test complete');

    assert.equal(countAfterBlocked, 3, 'same blocker must consume only the bounded initial attempt budget');
    assert.equal(calls.protect, 3, 'poll/errorRetry loops must not create fresh business episodes');
    assert.equal(status.details.protectionEpisode.state, 'WAITING_BLOCKED');
    assert.equal(status.details.protectionEpisode.sameBlockerAttempts, 3);
    assert.equal(new Set(calls.protectOptions.map(options => options.episodeId)).size, 1);
});

test('B5 verified storage continuation never opens craft early or consumes business failure quota', async () => {
    let slice = 0;
    const { mode, coordinator, calls } = harness({
        protectionImplementation: async () => {
            slice += 1;
            if (slice <= 2) {
                return {
                    success: true,
                    data: {
                        continuationRequired: true,
                        completeForEpisode: false,
                        trimmed: {
                            continuationRequired: true,
                            nextDelayMs: 1,
                            sliceNumber: slice,
                            sliceClicks: 64,
                            soldClicks: slice * 64,
                            clickBudget: 129,
                            actionsRemaining: 129 - (slice * 64),
                            retainedRemainderItems: { coal_block: 7 },
                            deferredNewInput: {}
                        }
                    }
                };
            }
            return { success: true, data: { continuationRequired: false, completeForEpisode: true } };
        }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.protect === 3 && calls.craft >= 1, 400);
    const status = mode.status();
    await mode.disable('test complete');

    assert.deepEqual(calls.sequence.slice(0, 4), ['protect', 'protect', 'protect', 'craft']);
    assert.equal(status.details.protectionEpisode.continuationSlices, 2);
    assert.equal(status.details.protectionEpisode.businessFailureAttempts, 0);
    assert.equal(status.details.protectionEpisode.state, 'COMPLETE');
    assert.equal(status.details.protectionEpisode.lastProgress.soldClicks, 128);
});

test('B5 reserve-input continuation keeps the locked baseline and never becomes a business blocker', async () => {
    let poll = 0;
    const { mode, coordinator, calls } = harness({
        protectionImplementation: async () => {
            poll += 1;
            if (poll <= 2) {
                return {
                    success: true,
                    data: {
                        continuationRequired: true,
                        completeForEpisode: false,
                        trimmed: {
                            continuationRequired: true,
                            waitingForReserveInput: true,
                            nextDelayMs: 1,
                            baselineDigest: 'locked-baseline',
                            actionsRemaining: 0,
                            reserveShortages: [{ baseId: 'cobblestone', coverage: 1.25, missingBaseUnits: 4 }],
                            finalCoverage: { cobblestone: { coverage: 1.25 } }
                        }
                    }
                };
            }
            return { success: true, data: { continuationRequired: false, completeForEpisode: true } };
        }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.protect === 3 && calls.craft >= 1, 400);
    const status = mode.status();
    await mode.disable('test complete');

    assert.deepEqual(calls.sequence.slice(0, 4), ['protect', 'protect', 'protect', 'craft']);
    assert.equal(status.details.protectionEpisode.businessFailureAttempts, 0);
    assert.equal(status.details.protectionEpisode.baselineDigest, 'locked-baseline');
    assert.equal(status.details.protectionEpisode.lastProgress.step, 'reserve-input-checkpoint');
    assert.equal(status.details.protectionEpisode.lastProgress.reserveShortages[0].baseId, 'cobblestone');
});

test('B5 timeout blocker signature ignores changing operation ids and exhausts as one blocker', async () => {
    const { mode, coordinator, calls } = harness({
        protectionImplementation: async () => {
            const operationId = `bot-01:${20 + calls.protect}`;
            const error = Object.assign(new Error(`Operation ${operationId} timed out.`), {
                code: 'TIMEOUT',
                details: { operationId, timeoutMs: 3000000 }
            });
            return { success: false, status: 'TIMEOUT', message: error.message, error };
        }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.protect === 3, 400);
    await new Promise(resolve => setTimeout(resolve, 30));
    const status = mode.status();
    await mode.disable('test complete');

    assert.equal(calls.protect, 3);
    assert.equal(status.details.protectionEpisode.businessFailureAttempts, 3);
    assert.equal(status.details.protectionEpisode.sameBlockerAttempts, 3);
    assert.equal(status.details.protectionEpisode.state, 'WAITING_BLOCKED');
    assert.equal(status.details.protectionEpisode.blocker.step, 'storage-protection-boundary');
    assert.equal(status.details.protectionEpisode.blocker.signature,
        'TIMEOUT:storage-protection-boundary:operation-timeout:');
});

test('B5 protection suppresses repeated blocker warnings and exposes bounded backoff status', async () => {
    const logs = { warn: [], debug: [] };
    const logger = {
        warn(message, meta) { logs.warn.push({ message, meta }); },
        debug(message, meta) { logs.debug.push({ message, meta }); },
        info() {}, error() {}
    };
    const { mode, coordinator, calls } = harness({
        logger,
        protectionImplementation: async () => stableProtectionBlocker()
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.protect === 3, 300);
    await new Promise(resolve => setTimeout(resolve, 20));
    const status = mode.status();
    await mode.disable('test complete');

    const protectionWarnings = logs.warn.filter(entry => entry.meta?.step === 'storage-protection-blocked');
    const protectionDebug = logs.debug.filter(entry => entry.meta?.step === 'storage-protection-blocked');
    assert.equal(protectionWarnings.length, 2, 'only first and exhausted blocker attempts should warn');
    assert.ok(protectionDebug.length >= 1, 'identical middle repeats should be suppressed to debug');
    assert.equal(status.details.protectionEpisode.totalAttempts, 3);
    assert.ok(Number.isFinite(status.details.protectionEpisode.nextEligibleAt));
    assert.equal(status.details.waitingReason, 'storage-protection-blocked');
});

test('B5 protection relevant evidence change grants one controlled retry without a new episode', async () => {
    const evidence = { value: 'stock-v1' };
    const { mode, coordinator, calls } = harness({
        protectionEvidenceKeyImplementation: () => evidence.value,
        protectionImplementation: async () => stableProtectionBlocker()
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.protect === 3, 300);
    await new Promise(resolve => setTimeout(resolve, 20));
    const episodeId = mode.status().details.protectionEpisode.episodeId;

    evidence.value = 'stock-v2';
    await waitUntil(() => calls.protect === 4, 300);
    await new Promise(resolve => setTimeout(resolve, 35));
    const status = mode.status();
    await mode.disable('test complete');

    assert.equal(calls.protect, 4, 'one evidence change grants one side-effect retry, not a new automatic window');
    assert.equal(status.details.protectionEpisode.episodeId, episodeId);
    assert.equal(status.details.protectionEpisode.state, 'WAITING_BLOCKED');
    assert.equal(status.details.protectionEpisode.totalAttempts, 4);
});

test('XP-014 guarded operator retry accepts only the current blocked episode and is idempotent', async () => {
    const published = [];
    const { mode, coordinator, calls } = harness({
        failurePublisher: { publish: event => { published.push(event); return event; } },
        protectionImplementation: async () => stableProtectionBlocker()
    });
    await coordinator.initialize(); await coordinator.start();
    try {
        assert.equal((await mode.enable()).success, true);
        await waitUntil(() => mode.status().phase === 'WAITING_BLOCKED', 400);
        const status = mode.status();
        const episode = status.details.protectionEpisode;
        assert.ok(status.details.recovery.allowedActions.includes('retry-storage-protection'));

        const stale = mode.requestStorageProtectionRetry({
            expectedBotId: 'bot-01', expectedGeneration: 6, episodeId: episode.episodeId,
            incidentId: episode.correlationId, idempotencyKey: 'stale-retry'
        });
        assert.equal(stale.success, false);
        assert.equal(stale.error.code, 'B5_RETRY_STALE_GENERATION');

        const request = {
            expectedBotId: 'bot-01', expectedGeneration: 7, episodeId: episode.episodeId,
            incidentId: episode.correlationId, idempotencyKey: 'operator-retry-1'
        };
        const accepted = mode.requestStorageProtectionRetry(request);
        const duplicate = mode.requestStorageProtectionRetry(request);
        assert.equal(accepted.success, true);
        assert.equal(duplicate, accepted);
        const conflict = mode.requestStorageProtectionRetry({ ...request, expectedGeneration: 6 });
        assert.equal(conflict.success, false);
        assert.equal(conflict.error.code, 'B5_RETRY_IDEMPOTENCY_CONFLICT');
        const deadline = Date.now() + 600;
        while (calls.protect < 4 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 2));
        assert.ok(calls.protect >= 4, JSON.stringify(mode.status()));
        await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(mode.status().details.protectionEpisode.state, 'WAITING_BLOCKED');
        assert.equal(published.filter(event => event.details?.faultClass === 'BUSINESS_BLOCKER').length, 1);
    } finally {
        await mode.disable('test complete');
    }
});

test('B5 protection forwards one root operation context through each attempt with stable business correlation', async () => {
    const generationRef = { value: 7 };
    const observed = [];
    const { mode, coordinator, calls } = harness({
        generationRef,
        protectionImplementation: async options => {
            observed.push({
                generation: options.expectedGeneration,
                batchId: options.batchId,
                episodeId: options.episodeId,
                operationId: options.operationContext?.operationId,
                correlationId: options.operationContext?.correlationId,
                contextGeneration: options.operationContext?.connectionGeneration
            });
            if (observed.length === 1) generationRef.value = 8;
            return { success: true, data: { completeForEpisode: true } };
        }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.protect >= 2 && calls.craft >= 1, 300);
    await mode.disable('test complete');

    assert.equal(observed.length >= 2, true);
    assert.equal(observed[0].batchId, observed[1].batchId);
    assert.equal(observed[0].episodeId, observed[1].episodeId);
    assert.equal(observed[0].correlationId, observed[1].correlationId);
    assert.notEqual(observed[0].operationId, observed[1].operationId, 'each execution attempt has its own operation id');
    assert.deepEqual(observed.slice(0, 2).map(item => item.contextGeneration), [7, 8]);
});

function uncertainFinalB5Result({ generation = 7, outputCountBefore = 0, vaultBefore = 10, operationId = 'craft-op-final' } = {}) {
    const error = Object.assign(new Error('uncertain final B5'), {
        code: 'CRAFTING_OUTCOME_UNCERTAIN',
        details: {
            recipeId: 'super_alloy',
            outputId: 'super_alloy',
            b5CompletionContext: { finalChain: true, targetId: 'super_alloy', targetVaultBefore: vaultBefore },
            amount: 1,
            expectedDelta: 1,
            operationId,
            correlationId: 'corr-final-b5',
            reconciliationBaseline: {
                output: { source: 'inventory', count: outputCountBefore },
                inputs: {}
            },
            inputEvidence: [],
            outcome: {
                requiresReconciliation: true,
                observedSideEffect: true,
                outputId: 'super_alloy',
                recipeId: 'super_alloy',
                unexpectedIdentityDeltas: []
            }
        }
    });
    return {
        success: false,
        status: 'VERIFICATION_FAILED',
        message: error.message,
        error,
        meta: { operationId, correlationId: 'corr-final-b5', connectionGeneration: generation }
    };
}


async function actualWrappedUncertainFinalChainResult({ leafOutputId = 'super_alloy', vaultBefore = 10 } = {}) {
    const manager = new OperationManager({
        botId: 'bot-01',
        queue: new OperationQueue({ maxPending: 8 }),
        lockPolicy: new OperationLockPolicy(),
        timeoutPolicy: new OperationTimeoutPolicy(),
        config: { defaultQueueWaitTimeoutMs: 50, defaultExecutionTimeoutMs: 500, shutdownDrainTimeoutMs: 100 }
    });
    const leaf = new FlowError('uncertain final-chain craft', {
        code: 'CRAFTING_OUTCOME_UNCERTAIN',
        retryable: false,
        subsystem: 'crafting', operation: 'CraftingOperation', step: 'verify-output',
        action: 'reconcile quantity 1', resource: leafOutputId,
        details: {
            recipeId: leafOutputId,
            outputId: leafOutputId,
            amount: 1,
            expectedDelta: 1,
            operationId: `op-${leafOutputId}`,
            correlationId: `corr-${leafOutputId}`,
            reconciliationBaseline: { output: { source: 'inventory', count: 0 }, inputs: {} },
            inputEvidence: [],
            outcome: {
                state: 'UNCERTAIN',
                requiresReconciliation: true,
                safeToBlindRetry: false,
                observedSideEffect: true,
                outputId: leafOutputId,
                recipeId: leafOutputId
            }
        }
    });
    const finalSteps = leafOutputId === 'super_alloy'
        ? [{ recipeId: 'super_alloy', outputId: 'super_alloy', crafts: 1 }]
        : [
            { recipeId: leafOutputId, outputId: leafOutputId, crafts: 1 },
            { recipeId: 'super_alloy', outputId: 'super_alloy', crafts: 1 }
        ];
    const inspection = () => Result.ok({
        personalVault: { totals: { super_alloy: vaultBefore }, emptySlotCount: 36, slotCount: 54 },
        personalVaultPressure: { allowNewIntermediates: true, critical: false },
        inventoryTotals: {},
        fullPlan: { targetId: 'super_alloy', feasible: true },
        finalSteps,
        chains: [],
        progress: {}
    });
    const service = new B5AutomationService({
        planningService: {
            async inspectAdditional() { return inspection(); },
            async inspectAdditionalFresh() { return inspection(); }
        },
        crafting: { async craft() { return Result.fail('VERIFICATION_FAILED', leaf.message, leaf, leaf.details); } },
        personalVault: {
            async deposit() { throw new Error('deposit must not run after uncertain craft'); },
            async read() { return Result.ok({ totals: { super_alloy: vaultBefore } }); },
            async withdraw() { return Result.ok({}); }
        },
        storage: {},
        b1Materials: {
            async compactAll() { return Result.ok({}); },
            async sellLargestStoredBlock() { return Result.ok({}); },
            async ensureBaseAvailable() { return Result.ok({}); },
            async compact() { return Result.ok({}); }
        },
        inventoryReader: { read: () => ({ emptySlotCount: 36 }) },
        inventoryCounter: { count: () => 0 },
        recipeRegistry: { require(id) { return { output: id, inputs: {} }; } },
        operationManager: manager,
        context: { getGeneration: () => 7 },
        config: { timeoutMs: 500, inventorySafetyEmptySlots: 2, targetId: 'super_alloy' }
    });
    try {
        return await service.runNext({ expectedGeneration: 7 });
    } finally {
        await manager.stop();
    }
}

test('B5 protection reconnect storm does not charge stale aborts to business failure quota', async () => {
    const generationRef = { value: 7 };
    const observed = [];
    const { mode, coordinator, calls } = harness({
        generationRef,
        protectionImplementation: async options => {
            observed.push({
                batchId: options.batchId,
                episodeId: options.episodeId,
                correlationId: options.operationContext?.correlationId,
                generation: options.expectedGeneration
            });
            if (observed.length <= 7) generationRef.value += 1;
            return { success: true, data: { completeForEpisode: true } };
        }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.protect >= 8 && calls.craft >= 1, 700);
    const status = mode.status();
    await mode.disable('test complete');

    assert.ok(status.details.protectionEpisode.attemptsStarted >= 8);
    assert.equal(status.details.protectionEpisode.businessFailureAttempts, 0);
    assert.ok(status.details.protectionEpisode.staleAborts >= 7);
    assert.equal(new Set(observed.map(entry => entry.batchId)).size, 1);
    assert.equal(new Set(observed.map(entry => entry.episodeId)).size, 1);
    assert.equal(new Set(observed.map(entry => entry.correlationId)).size, 1);
    assert.equal(status.details.batchProtectionCompleted, true);
});

test('B5 non-retryable protection blocker runs once then waits for operator/config trigger', async () => {
    const error = Object.assign(new Error('selling disabled'), {
        code: 'B1_B5_PROTECTION_SELL_DISABLED',
        step: 'sell-baseline',
        retryable: false,
        details: { blocker: { reason: 'selling-disabled', material: 'coal', sellId: 'coal_block' } }
    });
    const { mode, coordinator, calls } = harness({
        protectionImplementation: async () => ({ success: false, status: 'NOT_READY', message: error.message, error })
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.protect === 1, 300);
    await new Promise(resolve => setTimeout(resolve, 60));
    const status = mode.status();
    await mode.disable('test complete');

    assert.equal(calls.protect, 1);
    assert.equal(status.details.protectionEpisode.businessFailureAttempts, 1);
    assert.equal(status.details.protectionEpisode.blocker.retryable, false);
    assert.equal(status.details.protectionEpisode.state, 'WAITING_BLOCKED');
});

test('uncertain final B5 proven already stored in PV2 accounts once and protects before any next craft', async () => {
    let craftCall = 0;
    const { mode, coordinator, calls } = harness({
        craftImplementation: async () => {
            craftCall += 1;
            if (craftCall === 1) return uncertainFinalB5Result();
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false } };
        },
        planningImplementation: async () => ({
            success: true,
            data: {
                inventoryTotals: { super_alloy: 0 },
                personalVault: { totals: { super_alloy: 11 } },
                storage: { items: {} }
            }
        })
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.protect >= 2 && calls.craft >= 2, 700);
    const status = mode.status();
    await mode.disable('test complete');

    assert.equal(status.details.completedB5, 1);
    assert.equal(calls.protectOptions[0].trigger, 'explicit-enable');
    assert.equal(calls.protectOptions[1].trigger, 'post-b5-complete');
    const firstCraft = calls.sequence.indexOf('craft');
    const secondProtect = calls.sequence.indexOf('protect', 1);
    const secondCraft = calls.sequence.indexOf('craft', firstCraft + 1);
    assert.ok(firstCraft >= 0 && secondProtect > firstCraft && secondCraft > secondProtect,
        `next craft must be after post-B5 protection: ${calls.sequence.join(' -> ')}`);
    assert.equal(status.details.pendingB5CompletionProvenance, null);
});

test('uncertain final B5 proven in inventory arms next protection only after verified recovery deposit', async () => {
    let craftCall = 0;
    const { mode, coordinator, calls } = harness({
        craftImplementation: async () => {
            craftCall += 1;
            if (craftCall === 1) return uncertainFinalB5Result();
            if (craftCall === 2) {
                return {
                    success: true,
                    data: {
                        recoveredExistingB5: true,
                        recoveredAmount: 1,
                        targetId: 'super_alloy',
                        complete: false,
                        productive: true
                    }
                };
            }
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false } };
        },
        planningImplementation: async () => ({
            success: true,
            data: {
                inventoryTotals: { super_alloy: 1 },
                personalVault: { totals: { super_alloy: 10 } },
                storage: { items: {} }
            }
        })
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.protect >= 2 && calls.craft >= 3, 700);
    const status = mode.status();
    await mode.disable('test complete');

    assert.equal(status.details.completedB5, 1);
    assert.equal(calls.protectOptions[1].trigger, 'post-b5-complete');
    const crafts = calls.sequence.reduce((acc, value, index) => { if (value === 'craft') acc.push(index); return acc; }, []);
    const protects = calls.sequence.reduce((acc, value, index) => { if (value === 'protect') acc.push(index); return acc; }, []);
    assert.ok(crafts[0] < crafts[1], 'uncertain craft must be followed by recovery');
    assert.ok(crafts[1] < protects[1], 'recovery deposit must finish before post-B5 protection');
    assert.ok(protects[1] < crafts[2], 'no next B5 craft may run before post-B5 protection');
});

test('startup orphan B5 recovery does not invent a post-B5 boundary without uncertain-operation provenance', async () => {
    let craftCall = 0;
    const { mode, coordinator, calls } = harness({
        craftImplementation: async () => {
            craftCall += 1;
            if (craftCall === 1) {
                return {
                    success: true,
                    data: { recoveredExistingB5: true, recoveredAmount: 1, targetId: 'super_alloy', productive: true }
                };
            }
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false } };
        }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.craft >= 2, 400);
    await new Promise(resolve => setTimeout(resolve, 20));
    const status = mode.status();
    await mode.disable('test complete');

    assert.equal(calls.protect, 1, 'orphan recovery must not create a fake post-B5 boundary');
    assert.equal(status.details.completedB5, 0);
});

test('uncertain final B5 can fresh-reconcile and recover on a replacement generation without stale mutation', async () => {
    const generationRef = { value: 7 };
    let craftCall = 0;
    let freshCall = 0;
    const { mode, coordinator, calls } = harness({
        generationRef,
        craftImplementation: async options => {
            craftCall += 1;
            if (craftCall === 1) return uncertainFinalB5Result({ generation: 7 });
            if (options.recoveryOnly === true) {
                return {
                    success: true,
                    data: { recoveryOnly: true, recoveredExistingB5: true, recoveredAmount: 1, targetId: 'super_alloy', productive: true }
                };
            }
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false } };
        },
        planningImplementation: async () => {
            freshCall += 1;
            if (freshCall === 1) generationRef.value = 8; // discard generation-7 fresh callback
            return {
                success: true,
                data: {
                    inventoryTotals: { super_alloy: 1 },
                    personalVault: { totals: { super_alloy: 10 } },
                    storage: { items: {} }
                }
            };
        }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.protect >= 2 && calls.craft >= 3, 900);
    const status = mode.status();
    await mode.disable('test complete');

    assert.equal(status.details.completedB5, 1);
    assert.ok(freshCall >= 2, 'replacement generation must perform a fresh physical reconciliation');
    assert.equal(calls.protectOptions.filter(entry => entry.trigger === 'post-b5-complete').length, 1);
    const protect2 = calls.sequence.indexOf('protect', 1);
    const crafts = calls.sequence.reduce((out, value, index) => { if (value === 'craft') out.push(index); return out; }, []);
    assert.ok(protect2 > crafts[1] && protect2 < crafts[2], `post gate must separate recovery from next craft: ${calls.sequence.join(' -> ')}`);
});

test('generation change after inventory proof rebinds provenance by fresh read before recovery', async () => {
    const generationRef = { value: 7 };
    let craftCall = 0;
    let freshCall = 0;
    const { mode, coordinator, calls } = harness({
        generationRef,
        craftImplementation: async options => {
            craftCall += 1;
            if (craftCall === 1) return uncertainFinalB5Result({ generation: 7 });
            if (options.recoveryOnly === true && craftCall === 2) {
                generationRef.value = 8;
                return { success: true, data: { recoveryOnly: true, recoveredExistingB5: true, recoveredAmount: 1, targetId: 'super_alloy', productive: true } };
            }
            if (options.recoveryOnly === true) {
                return { success: true, data: { recoveryOnly: true, recoveredExistingB5: true, recoveredAmount: 1, targetId: 'super_alloy', productive: true } };
            }
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false } };
        },
        planningImplementation: async () => {
            freshCall += 1;
            return { success: true, data: { inventoryTotals: { super_alloy: 1 }, personalVault: { totals: { super_alloy: 10 } }, storage: { items: {} } } };
        }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.protect >= 2 && mode.status().details.completedB5 === 1, 900);
    const status = mode.status();
    await mode.disable('test complete');
    assert.equal(status.details.completedB5, 1);
    assert.ok(freshCall >= 2, 'generation 8 must fresh-read before retrying recovery');
    assert.equal(calls.protectOptions.filter(entry => entry.trigger === 'post-b5-complete').length, 1);
});

test('repeated recovery callbacks for one uncertain final B5 account and arm exactly once', async () => {
    let craftCall = 0;
    const { mode, coordinator, calls } = harness({
        craftImplementation: async () => {
            craftCall += 1;
            if (craftCall === 1) return uncertainFinalB5Result();
            if (craftCall <= 3) {
                return {
                    success: true,
                    data: { recoveredExistingB5: true, recoveredAmount: 1, targetId: 'super_alloy', productive: true }
                };
            }
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false } };
        },
        planningImplementation: async () => ({
            success: true,
            data: {
                inventoryTotals: { super_alloy: 1 },
                personalVault: { totals: { super_alloy: 10 } },
                storage: { items: {} }
            }
        })
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.craft >= 4 && calls.protect >= 2, 700);
    const status = mode.status();
    await mode.disable('test complete');

    assert.equal(status.details.completedB5, 1, 'same uncertain operation must be accounted once');
    assert.equal(calls.protectOptions.filter(entry => entry.trigger === 'post-b5-complete').length, 1,
        'same uncertain operation must arm exactly one post-B5 gate');
});


test('real StepRunner final-B5 error shape is normalized before B5CraftMode capture and arms post gate after PV2 proof', async () => {
    const runtimeResult = await actualWrappedUncertainFinalChainResult({ leafOutputId: 'super_alloy', vaultBefore: 10 });
    assert.equal(runtimeResult.error.code, 'CRAFTING_OUTCOME_UNCERTAIN');
    assert.equal(runtimeResult.error.details.b5CompletionContext.targetId, 'super_alloy');
    assert.equal(runtimeResult.error.details.b5CompletionContext.targetVaultBefore, 10);
    assert.ok(Array.isArray(runtimeResult.error.details.parentFlow));

    let craftCall = 0;
    const { mode, coordinator, calls } = harness({
        craftImplementation: async () => {
            craftCall += 1;
            if (craftCall === 1) return runtimeResult;
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false } };
        },
        planningImplementation: async () => ({
            success: true,
            data: { inventoryTotals: { super_alloy: 0 }, personalVault: { totals: { super_alloy: 11 } }, storage: { items: {} } }
        })
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => mode.status().details.completedB5 === 1 && calls.protect >= 2, 900);
    const status = mode.status();
    await mode.disable('test complete');
    assert.equal(status.details.completedB5, 1);
    assert.equal(calls.protectOptions.filter(entry => entry.trigger === 'post-b5-complete').length, 1);
});

test('real StepRunner uncertain B4 inside final chain is not classified as final B5 completion', async () => {
    const runtimeResult = await actualWrappedUncertainFinalChainResult({ leafOutputId: 'alloy_b4', vaultBefore: 10 });
    assert.equal(runtimeResult.error.details.b5CompletionContext.targetId, 'super_alloy');
    assert.equal(runtimeResult.error.details.outputId, 'alloy_b4');
    let craftCall = 0;
    const { mode, coordinator, calls } = harness({
        craftImplementation: async () => {
            craftCall += 1;
            if (craftCall === 1) return runtimeResult;
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false } };
        },
        planningImplementation: async () => ({
            success: true,
            data: { inventoryTotals: { alloy_b4: 1 }, personalVault: { totals: { super_alloy: 10 } }, storage: { items: {} } }
        })
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.craft >= 2, 500);
    const status = mode.status();
    await mode.disable('test complete');
    assert.equal(status.details.completedB5, 0);
    assert.equal(calls.protectOptions.filter(entry => entry.trigger === 'post-b5-complete').length, 0);
});

test('recovery accounts only provenance amount when recovery also deposits extra orphan B5', async () => {
    let craftCall = 0;
    const { mode, coordinator, calls } = harness({
        craftImplementation: async options => {
            craftCall += 1;
            if (craftCall === 1) return uncertainFinalB5Result();
            if (options.recoveryOnly === true) {
                return { success: true, data: { recoveryOnly: true, recoveredExistingB5: true, recoveredAmount: 3, targetId: 'super_alloy', productive: true } };
            }
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false } };
        },
        planningImplementation: async () => ({
            success: true,
            data: { inventoryTotals: { super_alloy: 3 }, personalVault: { totals: { super_alloy: 10 } }, storage: { items: {} } }
        })
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => mode.status().details.completedB5 === 1 && calls.protect >= 2, 700);
    const status = mode.status();
    await mode.disable('test complete');
    assert.equal(status.details.completedB5, 1);
    assert.equal(calls.protectOptions.filter(entry => entry.trigger === 'post-b5-complete').length, 1);
});

test('recovery below provenance amount does not account, clear provenance, or arm a post gate', async () => {
    let craftCall = 0;
    const uncertain = uncertainFinalB5Result();
    uncertain.error.details.expectedDelta = 2;
    uncertain.error.details.amount = 2;
    const { mode, coordinator, calls } = harness({
        craftImplementation: async options => {
            craftCall += 1;
            if (craftCall === 1) return uncertain;
            if (options.recoveryOnly === true) {
                return { success: true, data: { recoveryOnly: true, recoveredExistingB5: true, recoveredAmount: 1, targetId: 'super_alloy', productive: true } };
            }
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false } };
        },
        planningImplementation: async () => ({
            success: true,
            data: { inventoryTotals: { super_alloy: 2 }, personalVault: { totals: { super_alloy: 10 } }, storage: { items: {} } }
        })
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.craft >= 2, 500);
    await new Promise(resolve => setTimeout(resolve, 30));
    const status = mode.status();
    await mode.disable('test complete');
    assert.equal(status.details.completedB5, 0);
    assert.ok(status.details.pendingB5CompletionProvenance);
    assert.equal(calls.protectOptions.filter(entry => entry.trigger === 'post-b5-complete').length, 0);
});

test('replacement generation fresh PV2 proof accounts original uncertain marker exactly once', async () => {
    const generationRef = { value: 7 };
    let craftCall = 0;
    let freshCall = 0;
    const { mode, coordinator, calls } = harness({
        generationRef,
        craftImplementation: async () => {
            craftCall += 1;
            if (craftCall === 1) return uncertainFinalB5Result({ generation: 7 });
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false } };
        },
        planningImplementation: async () => {
            freshCall += 1;
            if (freshCall === 1) {
                generationRef.value = 8;
                return { success: true, data: { inventoryTotals: {}, personalVault: { totals: { super_alloy: 10 } }, storage: { items: {} } } };
            }
            return { success: true, data: { inventoryTotals: {}, personalVault: { totals: { super_alloy: 11 } }, storage: { items: {} } } };
        }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => mode.status().details.completedB5 === 1 && calls.protect >= 2, 800);
    const status = mode.status();
    await mode.disable('test complete');
    assert.equal(status.details.completedB5, 1);
    assert.equal(calls.protectOptions.filter(entry => entry.trigger === 'post-b5-complete').length, 1);
    assert.ok(freshCall >= 2);
});

test('replacement generation can prove final uncertain click had no effect and safely re-plan without a post gate', async () => {
    const generationRef = { value: 7 };
    let craftCall = 0;
    let freshCall = 0;
    const uncertain = uncertainFinalB5Result({ generation: 7 });
    uncertain.error.details.outcome.observedSideEffect = false;
    uncertain.error.details.reconciliationBaseline.inputs = { tungsten: { source: 'inventory', count: 8 } };
    uncertain.error.details.inputEvidence = [{ inputId: 'tungsten', expected: 1, source: 'inventory' }];
    const { mode, coordinator, calls } = harness({
        generationRef,
        craftImplementation: async () => {
            craftCall += 1;
            if (craftCall === 1) return uncertain;
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false } };
        },
        planningImplementation: async () => {
            freshCall += 1;
            if (freshCall === 1) generationRef.value = 8;
            return {
                success: true,
                data: {
                    inventoryTotals: { tungsten: 8, super_alloy: 0 },
                    personalVault: { totals: { super_alloy: 10 } },
                    storage: { items: {} }
                }
            };
        }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => calls.craft >= 2, 700);
    const status = mode.status();
    await mode.disable('test complete');
    assert.equal(status.details.completedB5, 0);
    assert.equal(calls.protectOptions.filter(entry => entry.trigger === 'post-b5-complete').length, 0);
    assert.equal(status.details.pendingCraftReconciliation, null);
    assert.ok(freshCall >= 3, 'one stale read plus repeated current-generation no-effect proof is required');
});

test('ambiguous final-B5 state after reconnect stays quarantined, does not re-click, and exposes actionable status', async () => {
    const generationRef = { value: 7 };
    let craftCall = 0;
    let freshCall = 0;
    const { mode, coordinator, calls } = harness({
        generationRef,
        craftImplementation: async () => {
            craftCall += 1;
            if (craftCall === 1) return uncertainFinalB5Result({ generation: 7 });
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false } };
        },
        planningImplementation: async () => {
            freshCall += 1;
            if (freshCall === 1) generationRef.value = 8;
            return { success: true, data: { inventoryTotals: { super_alloy: 0 }, personalVault: { totals: { super_alloy: 10 } }, storage: { items: {} } } };
        }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await new Promise(resolve => setTimeout(resolve, 70));
    const status = mode.status();
    await mode.disable('test complete');
    assert.equal(craftCall, 1, 'ambiguous reconciliation must never replay or start a new craft');
    assert.ok(freshCall >= 2, 'replacement generation must keep observing fresh state');
    assert.equal(status.phase, 'WAITING_RECONCILE');
    assert.equal(status.details.reconciliationAction, 'fresh-reconcile-quarantined-craft');
    assert.ok(['craft-inputs-not-observable', 'craft-outcome-uncertain', 'craft-no-effect-not-proven'].includes(status.details.waitingReason));
});

test('RF5 T1/T2 consecutive no-effect proof resets on generation change and resolves only after replacement generation reaches threshold', async () => {
    const generationRef = { value: 7 };
    let craftCall = 0;
    let freshCall = 0;
    const uncertain = uncertainFinalB5Result({ generation: 7 });
    uncertain.error.details.outcome.observedSideEffect = false;
    uncertain.error.details.reconciliationBaseline.inputs = { tungsten: { source: 'inventory', count: 8 } };
    uncertain.error.details.inputEvidence = [{ inputId: 'tungsten', expected: 1, source: 'inventory' }];
    const { mode, coordinator, calls } = harness({
        generationRef,
        reconciliation: { maxFreshReads: 3, retryMs: 20, unresolvedPollMs: 20, allowRetryAfterVerifiedNoEffect: true },
        craftImplementation: async () => {
            craftCall += 1;
            if (craftCall === 1) return uncertain;
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false } };
        },
        planningImplementation: async () => {
            freshCall += 1;
            return { success: true, data: { inventoryTotals: { tungsten: 8, super_alloy: 0 }, personalVault: { totals: { super_alloy: 10 } }, storage: { items: {} } } };
        }
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => {
        const pending = mode.status().details.pendingCraftReconciliation;
        return pending?.lastReconciliationGeneration === 7 && pending?.noEffectProofPasses === 2;
    }, 800);
    generationRef.value = 8;
    await waitUntil(() => mode.status().details.pendingCraftReconciliation?.lastReconciliationGeneration === 8, 800);
    const afterFirstG8 = mode.status().details.pendingCraftReconciliation;
    assert.ok(afterFirstG8);
    assert.equal(afterFirstG8.noEffectProofPasses, 1);
    assert.equal(afterFirstG8.generationProofReads, 1);
    assert.equal(afterFirstG8.evidenceGeneration, 8);
    assert.equal(craftCall, 1, 'replacement generation must not re-click before proving its own threshold');
    assert.equal(calls.protectOptions.filter(entry => entry.trigger === 'post-b5-complete').length, 0);
    await waitUntil(() => mode.status().details.pendingCraftReconciliation === null && craftCall >= 2, 1200);
    await mode.disable('test complete');
    assert.ok(freshCall >= 5, 'G7 two reads plus G8 three reads are required');
});

test('RF5 T3 mutation proof counter is generation-local and replacement generation does not inherit confirmation', async () => {
    const generationRef = { value: 7 };
    let craftCall = 0;
    const uncertain = uncertainFinalB5Result({ generation: 7 });
    uncertain.error.details.outcome.observedSideEffect = false;
    uncertain.error.details.reconciliationBaseline.inputs = { tungsten: { source: 'inventory', count: 8 } };
    uncertain.error.details.inputEvidence = [{ inputId: 'tungsten', expected: 1, source: 'inventory' }];
    const { mode, coordinator } = harness({
        generationRef,
        reconciliation: { maxFreshReads: 3, retryMs: 20, unresolvedPollMs: 20, allowRetryAfterVerifiedNoEffect: true },
        craftImplementation: async () => {
            craftCall += 1;
            if (craftCall === 1) return uncertain;
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false } };
        },
        planningImplementation: async () => ({
            success: true,
            data: { inventoryTotals: { tungsten: 7, super_alloy: 0 }, personalVault: { totals: { super_alloy: 10 } }, storage: { items: {} } }
        })
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    await waitUntil(() => {
        const pending = mode.status().details.pendingCraftReconciliation;
        return pending?.lastReconciliationGeneration === 7 && pending?.freshMutationProofPasses === 2;
    }, 800);
    generationRef.value = 8;
    await waitUntil(() => mode.status().details.pendingCraftReconciliation?.lastReconciliationGeneration === 8, 800);
    const pending = mode.status().details.pendingCraftReconciliation;
    await mode.disable('test complete');
    assert.equal(pending.freshMutationProofPasses, 1);
    assert.equal(pending.confirmedFreshSideEffect, false);
    assert.equal(pending.generationProofReads, 1);
    assert.equal(craftCall, 1);
});

test('RF5 T4 reconnect storm cannot combine proof passes across generations', async () => {
    const generationRef = { value: 7 };
    let craftCall = 0;
    const uncertain = uncertainFinalB5Result({ generation: 7 });
    uncertain.error.details.outcome.observedSideEffect = false;
    uncertain.error.details.reconciliationBaseline.inputs = { tungsten: { source: 'inventory', count: 8 } };
    uncertain.error.details.inputEvidence = [{ inputId: 'tungsten', expected: 1, source: 'inventory' }];
    const { mode, coordinator } = harness({
        generationRef,
        reconciliation: { maxFreshReads: 3, retryMs: 15, unresolvedPollMs: 15, allowRetryAfterVerifiedNoEffect: true },
        craftImplementation: async () => {
            craftCall += 1;
            if (craftCall === 1) return uncertain;
            return { success: true, data: { complete: false, waitingForMaterials: true, productive: false } };
        },
        planningImplementation: async () => ({
            success: true,
            data: { inventoryTotals: { tungsten: 8, super_alloy: 0 }, personalVault: { totals: { super_alloy: 10 } }, storage: { items: {} } }
        })
    });
    await coordinator.initialize(); await coordinator.start();
    assert.equal((await mode.enable()).success, true);
    for (let generation = 7; generation < 12; generation += 1) {
        await waitUntil(() => {
            const p = mode.status().details.pendingCraftReconciliation;
            return p?.lastReconciliationGeneration === generation && p?.generationProofReads >= 1;
        }, 900);
        assert.ok(mode.status().details.pendingCraftReconciliation, `generation ${generation} must remain quarantined`);
        generationRef.value = generation + 1;
    }
    await waitUntil(() => {
        const p = mode.status().details.pendingCraftReconciliation;
        return p?.lastReconciliationGeneration === 12 && p?.generationProofReads === 1;
    }, 900);
    assert.equal(craftCall, 1, 'storm must not replay uncertain craft');
    await waitUntil(() => mode.status().details.pendingCraftReconciliation === null && craftCall >= 2, 1200);
    await mode.disable('test complete');
});
