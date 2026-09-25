'use strict';

const Operation = require('../../operations/Operation');
const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const FlowError = require('../../shared/errors/FlowError');
const B5ReadFlow = require('./b5/flows/B5ReadFlow');
const B5PlanningFlow = require('./b5/flows/B5PlanningFlow');
const B5StorageFlow = require('./b5/flows/B5StorageFlow');
const B5WithdrawFlow = require('./b5/flows/B5WithdrawFlow');
const B5CraftFlow = require('./b5/flows/B5CraftFlow');
const B2InputAcquisitionFlow = require('./b5/flows/B2InputAcquisitionFlow');
const B5ProgressTracker = require('./b5/support/B5ProgressTracker');
const B5InventoryState = require('./b5/support/B5InventoryState');
const B5RecipeResolver = require('./b5/support/B5RecipeResolver');
const B5B1InventoryCoordinator = require('./b5/B5B1InventoryCoordinator');
const B5FinalCraftCoordinator = require('./b5/B5FinalCraftCoordinator');
const B5IntermediateCoordinator = require('./b5/B5IntermediateCoordinator');
const B5ReserveChainCoordinator = require('./b5/B5ReserveChainCoordinator');
const B5CycleCoordinator = require('./b5/B5CycleCoordinator');
const PersonalVaultStorageFlow = require('../personal-vault/PersonalVaultStorageFlow');

class B5AutomationService {
    constructor({
        planningService,
        crafting,
        personalVault,
        storage,
        b1Materials,
        inventoryReader,
        inventoryCounter,
        recipeRegistry,
        operationManager,
        context = null,
        traceRecorder = null,
        config,
        logger = null,
        flows = {},
        inventoryState,
        craftingVerificationService
    }) {
        if (!craftingVerificationService) {
            throw new TypeError('B5AutomationService craftingVerificationService is required.');
        }
        Object.assign(this, {
            planningService,
            crafting,
            personalVault,
            storage,
            b1Materials,
            inventoryReader,
            inventoryCounter,
            recipeRegistry,
            operationManager,
            context,
            traceRecorder,
            config,
            logger
        });
        this.progressTracker = new B5ProgressTracker({ logger });
        this.inventoryState = new B5InventoryState({ inventoryReader, inventoryCounter, config });
        this.recipeResolver = new B5RecipeResolver({ recipeRegistry, config, logger });
        this.flows = Object.freeze({
            read: flows.read || new B5ReadFlow({ planningService, storage, personalVault, inventoryReader }),
            plan: flows.plan || new B5PlanningFlow({ recipeRegistry, config }),
            storage: flows.storage || new B5StorageFlow({ b1Materials }),
            b2Input: flows.b2Input || new B2InputAcquisitionFlow({
                storage,
                source: config?.b2InputSource === 'inventory' ? 'inventory' : 'storage'
            }),
            deposit: flows.deposit || new PersonalVaultStorageFlow({ personalVault, config: { verify: true } }),
            withdraw: flows.withdraw || new B5WithdrawFlow({ personalVault }),
            craft: flows.craft || new B5CraftFlow({ crafting })
        });
        this.finalCraft = new B5FinalCraftCoordinator({
            recipeRegistry,
            inventoryState: this.inventoryState,
            progressTracker: this.progressTracker,
            withdrawFlow: this.flows.withdraw,
            craftFlow: this.flows.craft,
            config,
            runStep: (...args) => this.#runStep(...args),
            childOptions: (...args) => this.#childOptions(...args),
            quantityTrace: (...args) => this.#quantityTrace(...args),
            verificationService: craftingVerificationService
        });
        this.intermediate = new B5IntermediateCoordinator({
            flows: this.flows,
            inventoryState: this.inventoryState,
            inventoryCounter,
            recipeResolver: this.recipeResolver,
            progressTracker: this.progressTracker,
            finalCraft: this.finalCraft,
            config,
            runStep: (...args) => this.#runStep(...args),
            childOptions: (...args) => this.#childOptions(...args)
        });
        this.b1Inventory = new B5B1InventoryCoordinator({
            storageFlow: this.flows.storage,
            b2Input: this.flows.b2Input,
            inventoryState: this.inventoryState,
            recipeRegistry,
            config,
            logger,
            runStep: (...args) => this.#runStep(...args),
            childOptions: (...args) => this.#childOptions(...args),
            ensureFreeIntermediateSlots: (...args) => this.intermediate.ensureFreeIntermediateSlots(...args),
            verificationService: craftingVerificationService
        });
        this.reserveChain = new B5ReserveChainCoordinator({
            flows: this.flows,
            b1Inventory: this.b1Inventory,
            intermediate: this.intermediate,
            inventoryState: this.inventoryState,
            inventoryCounter,
            progressTracker: this.progressTracker,
            finalCraft: this.finalCraft,
            config,
            logger,
            runStep: (...args) => this.#runStep(...args),
            childOptions: (...args) => this.#childOptions(...args),
            quantityTrace: (...args) => this.#quantityTrace(...args)
        });
        this.intermediate.setReserveCoordinator(this.reserveChain);
        this.cycle = new B5CycleCoordinator({
            flows: this.flows,
            inventoryState: this.inventoryState,
            recipeResolver: this.recipeResolver,
            progressTracker: this.progressTracker,
            intermediate: this.intermediate,
            reserveChain: this.reserveChain,
            b1Inventory: this.b1Inventory,
            finalCraft: this.finalCraft,
            config,
            logger,
            runStep: (...args) => this.#runStep(...args),
            childOptions: (...args) => this.#childOptions(...args),
            status: () => this.status()
        });
    }

    reconfigure(config = {}) {
        const next = config || {};
        this.config = next;
        this.inventoryState.config = next;
        this.recipeResolver.config = next;
        this.flows.plan.reconfigure?.(next);
        this.flows.b2Input.reconfigure?.({ source: next.b2InputSource === 'inventory' ? 'inventory' : 'storage' });
        this.b1Inventory.reconfigure(next);
        this.finalCraft.reconfigure(next);
        this.intermediate.reconfigure(next);
        this.reserveChain.reconfigure(next);
        this.cycle.reconfigure(next);
        return next;
    }

    status() {
        const base = this.progressTracker.status();
        const trace = this.traceRecorder?.latest?.() || null;
        return Object.freeze({
            ...base,
            trace: trace ? Object.freeze({
                traceId: trace.traceId,
                connectionGeneration: trace.connectionGeneration,
                productive: trace.productive,
                complete: trace.complete,
                plan: trace.plan,
                blockers: trace.blockers,
                traceEnvelope: trace.traceEnvelope ? Object.freeze({ contract: trace.traceEnvelope.contract, version: trace.traceEnvelope.version, traceId: trace.traceEnvelope.traceId, correlationId: trace.traceEnvelope.correlationId, decisionDigest: trace.traceEnvelope.decisionDigest }) : null,
                replay: trace.replayEnvelope ? Object.freeze({
                    contract: trace.replayEnvelope.contract,
                    version: trace.replayEnvelope.version,
                    digest: trace.replayEnvelope.digest,
                    domain: trace.replayEnvelope.domain,
                    profile: trace.replayEnvelope.profile,
                    policy: trace.replayEnvelope.policy
                }) : null,
                error: trace.error
            }) : null
        });
    }

    /**
     * Generic crafting-automation cycle for the configured default target.
     * Kept for internal callers: the result contract is already generic
     * ({ targetId, completedTarget, completedAmount } from the cycle).
     */
    run(amount = 1, { cancellationToken = null, operationContext = null, expectedGeneration = null, decompressionPolicy = 'unbounded', decompressionMaxUsageRatio = null, requireKnownCapacity = false } = {}) {
        return this.#runOperation(amount, { additional: false, cancellationToken, operationContext, expectedGeneration, mode: 'production', craftFinalTarget: true, allowNewB2: true, decompressionPolicy, decompressionMaxUsageRatio, requireKnownCapacity });
    }

    /**
     * Generic crafting-automation cycle without an explicit request target.
     * Preserved for compatibility callers (mode recovery/maintenance probes).
     * The result still carries the generic completion model below; no caller
     * may assume which item was planned when targetId is omitted.
     */
    runNext({ cancellationToken = null, operationContext = null, expectedGeneration = null, freshInspection = false, recoveryOnly = false, decompressionPolicy = 'unbounded', decompressionMaxUsageRatio = null, requireKnownCapacity = false } = {}) {
        return this.#runOperation(1, { additional: true, cancellationToken, operationContext, expectedGeneration, mode: 'production', craftFinalTarget: true, allowNewB2: true, freshInspection, recoveryOnly: recoveryOnly === true, decompressionPolicy, decompressionMaxUsageRatio, requireKnownCapacity });
    }

    /**
     * Primary generic entry: run exactly one crafting-automation cycle for an
     * explicit target. Fail-closed when targetId is missing: unlike the legacy
     * default path this never falls back to any configured item, so generic
     * callers must name the target they want crafted.
     *
     * Generic completion model (sole source of truth):
     * { targetId, completedTarget, completedAmount } + generic
     * blocker/error/result fields (waitingForMaterials, blockingReasons,
     * productive, targetReady, plan, progress).
     */
    runTarget({ targetId = null, cancellationToken = null, operationContext = null, expectedGeneration = null, freshInspection = false, recoveryOnly = false, decompressionPolicy = 'unbounded', decompressionMaxUsageRatio = null, requireKnownCapacity = false } = {}) {
        const resolvedTarget = String(targetId || '').trim();
        if (!resolvedTarget) {
            return Result.fail(
                Status.INVALID_INPUT,
                'Crafting automation requires an explicit targetId.',
                new FlowError('Crafting automation requires an explicit targetId; refusing to fall back to any default item.', {
                    code: 'CRAFT_TARGET_REQUIRED',
                    subsystem: 'crafting',
                    operation: 'CraftingAutomation',
                    step: 'resolve-target',
                    action: 'validate targetId',
                    resource: null,
                    retryable: false,
                    details: { targetId: targetId ?? null }
                }),
                { operation: 'CraftingAutomation', step: 'resolve-target', targetId: null }
            );
        }
        return this.#runOperation(1, {
            additional: true, targetId: resolvedTarget, cancellationToken, operationContext, expectedGeneration, mode: 'production',
            craftFinalTarget: true, allowNewB2: true, freshInspection, recoveryOnly: recoveryOnly === true,
            decompressionPolicy, decompressionMaxUsageRatio, requireKnownCapacity
        });
    }

    runMaintenance({ cancellationToken = null, operationContext = null, expectedGeneration = null, allowNewB2 = false, decompressionPolicy = 'unbounded', decompressionMaxUsageRatio = null, requireKnownCapacity = false } = {}) {
        return this.#runOperation(1, {
            additional: true, cancellationToken, operationContext, expectedGeneration,
            mode: 'maintenance', craftFinalTarget: false, allowNewB2: allowNewB2 === true,
            decompressionPolicy, decompressionMaxUsageRatio, requireKnownCapacity
        });
    }

    async #runOperation(amount, {
        additional,
        cancellationToken,
        operationContext = null,
        expectedGeneration = null,
        mode = 'production',
        craftFinalTarget = true,
        allowNewB2 = true,
        freshInspection = false,
        recoveryOnly = false,
        decompressionPolicy = 'unbounded',
        decompressionMaxUsageRatio = null,
        requireKnownCapacity = false,
        targetId = null
    }) {
        // Generic crafting-automation operation identity. Internal B5
        // coordinators/flows below keep their names; they are not the public
        // contract. The public result is the cycle data
        // ({ targetId, completedTarget, completedAmount } + generic blockers).
        const operationName = mode === 'maintenance' ? 'CraftingStorageMaintenance' : (additional ? 'CraftingAutomationNext' : 'CraftingAutomation');
        // Compatibility boundary: an omitted targetId resolves to the
        // configured default only for legacy run/runNext paths. runTarget
        // never reaches here without an explicit target (fail-closed above),
        // so generic mode never depends on a default-item fallback.
        const metadataTarget = String(targetId || '').trim() || this.config?.targetId || null;
        const operation = new Operation({
            name: operationName,
            lockKeys: ['gui', 'server-command', 'inventory', 'crafting', 'storage'],
            execute: context => this.cycle.execute(amount, context, { additional, mode, craftFinalTarget, allowNewB2, freshInspection, recoveryOnly, decompressionPolicy, decompressionMaxUsageRatio, requireKnownCapacity, targetId })
        });
        const result = await this.operationManager.run(operation, {
            operationContext,
            connectionGeneration: expectedGeneration ?? operationContext?.connectionGeneration ?? this.context?.getGeneration?.() ?? null,
            timeoutMs: this.config.timeoutMs,
            metadata: { operation: operationName, target: metadataTarget, targetId: metadataTarget, amount, additional, mode, craftFinalTarget, allowNewB2, freshInspection, recoveryOnly, decompressionPolicy, decompressionMaxUsageRatio, requireKnownCapacity },
            cancellationToken
        });
        this.traceRecorder?.recordResult?.(result, { mode, amount, targetId: metadataTarget });
        if (result?.success === false) {
            this.progressTracker.set({
                running: false,
                state: result?.status === 'CANCELLED' ? 'CANCELLED' : 'ERROR',
                currentStep: result?.meta?.step || this.status()?.currentStep,
                lastError: result?.message || result?.error?.message || 'Crafting automation failed'
            });
        }
        return result;
    }

    #quantityTrace() {}

    #runStep(context, meta, action, options = {}) {
        if (typeof context?.step === 'function') return context.step(meta, action, options);
        return Promise.resolve().then(action).then(result => {
            if (result?.success === false && options?.acceptFailedResult === true) return result;
            if (result?.success === false) {
                throw FlowError.fromResult(result, {
                    subsystem: meta?.subsystem || 'crafting',
                    operation: 'CraftingAutomation',
                    step: meta?.step || null,
                    action: meta?.action || null,
                    resource: meta?.resource || null,
                    details: meta?.details || null
                });
            }
            return result;
        });
    }

    #childOptions(context, extra = {}) {
        return {
            ...extra,
            cancellationToken: context?.cancellation?.token || null,
            operationContext: context || null,
            expectedGeneration: context?.connectionGeneration ?? null,
            operationId: context?.operationId || null,
            correlationId: context?.correlationId || null
        };
    }


}

module.exports = B5AutomationService;
