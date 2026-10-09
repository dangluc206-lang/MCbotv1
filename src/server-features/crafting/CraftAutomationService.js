'use strict';

const Operation = require('../../operations/Operation');
const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const FlowError = require('../../shared/errors/FlowError');
const CraftReadFlow = require('./flows/CraftReadFlow');
const CraftStorageFlow = require('./flows/CraftStorageFlow');
const CraftWithdrawFlow = require('./flows/CraftWithdrawFlow');
const CraftCraftFlow = require('./flows/CraftCraftFlow');
const CraftInputAcquisitionFlow = require('./flows/CraftInputAcquisitionFlow');
const CraftProgressTracker = require('./support/CraftProgressTracker');
const CraftInventoryState = require('./support/CraftInventoryState');
const CraftRecipeResolver = require('./support/CraftRecipeResolver');
const CraftBaseInventoryCoordinator = require('./coordinators/CraftBaseInventoryCoordinator');
const CraftFinalCraftCoordinator = require('./coordinators/CraftFinalCraftCoordinator');
const CraftIntermediateCoordinator = require('./coordinators/CraftIntermediateCoordinator');
const CraftReserveChainCoordinator = require('./coordinators/CraftReserveChainCoordinator');
const CraftCycleCoordinator = require('./coordinators/CraftCycleCoordinator');
const CraftQuantityPolicy = require('./support/CraftQuantityPolicy');
const PersonalVaultStorageFlow = require('../personal-vault/PersonalVaultStorageFlow');

// ponytail: automation reconfigure accepts both generic `inputSource` and legacy
// `b2InputSource` so the cycle boundary can forward one config object; generic wins,
// legacy names are mapped then dropped, and the stored config stays generic-only.
function normalizeAutomationConfig(next = {}, current = {}) {
    const source = next || {};
    const merged = {
        ...current,
        ...source,
        inputSource: source.inputSource ?? source.b2InputSource ?? current?.inputSource
    };
    delete merged.b2InputSource;
    return Object.freeze(merged);
}

class CraftAutomationService {
    constructor({
        planningService,
        crafting,
        personalVault,
        storage,
        b1Materials = null,
        storageMaterials = null,
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
        quantity = null,
        craftingVerificationService
    }) {
        if (!craftingVerificationService) {
            throw new TypeError('CraftAutomationService craftingVerificationService is required.');
        }
        // G16: generic material-readiness authority. `storageMaterials` is the
        // generic name (matches CraftPlanningService); `b1Materials` stays as a
        // compat alias for existing compositions. Same instance either way —
        // no second implementation.
        const materialReadiness = storageMaterials || b1Materials || null;
        Object.assign(this, {
            planningService,
            crafting,
            personalVault,
            storage,
            b1Materials: materialReadiness,
            storageMaterials: materialReadiness,
            inventoryReader,
            inventoryCounter,
            recipeRegistry,
            operationManager,
            context,
            traceRecorder,
            config,
            logger
        });
        this.progressTracker = new CraftProgressTracker({ logger });
        this.inventoryState = inventoryState || new CraftInventoryState({ inventoryReader, inventoryCounter, config });
        this.recipeResolver = new CraftRecipeResolver({ recipeRegistry, config, logger });
        // Generic quantity authority: injected by the composition root or derived
        // from config once (legacy B-chain key names are mapped at fromConfig).
        this.quantity = quantity || CraftQuantityPolicy.fromConfig(config);
        this.flows = Object.freeze({
            read: flows.read || new CraftReadFlow({ planningService, storage, personalVault, inventoryReader }),
            storage: flows.storage || new CraftStorageFlow({ storageMaterials: materialReadiness }),
            b2Input: flows.b2Input || flows.inputAcquisition || new CraftInputAcquisitionFlow({
                storage,
                source: (config?.inputSource ?? config?.b2InputSource) === 'inventory' ? 'inventory' : 'storage'
            }),
            deposit: flows.deposit || new PersonalVaultStorageFlow({ personalVault, config: { verify: true } }),
            withdraw: flows.withdraw || new CraftWithdrawFlow({ personalVault }),
            craft: flows.craft || new CraftCraftFlow({ crafting })
        });
        // G16: generic alias — same instance, no second flow.
        this.flows = Object.freeze({ ...this.flows, inputAcquisition: this.flows.b2Input });
        this.finalCraft = new CraftFinalCraftCoordinator({
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
        this.#buildGenericStack({ config, logger, inventoryCounter, recipeRegistry, craftingVerificationService });
        // Single generic execution path (G3):
        // CraftRequest -> Planner -> Input Acquisition -> Storage -> Craft Execution -> Verification.
        // No legacyCycle / B5CycleCoordinator / B5AutomationRuntimeDecorator branch remains here.
        // Compat aliases keep the same generic instances so older callers/tests reading
        // service.intermediate / reserveChain / b1Inventory still observe the generic stack.
        this.intermediate = this.genericIntermediate;
        this.baseInventory = this.genericBaseInventory;
        this.b1Inventory = this.genericBaseInventory;
        this.reserveChain = this.genericReserveChain;
        this.cycle = new CraftCycleCoordinator({
            flows: this.flows,
            inventoryState: this.inventoryState,
            recipeResolver: this.recipeResolver,
            progressTracker: this.progressTracker,
            intermediate: this.genericIntermediate,
            reserveChain: this.genericReserveChain,
            baseInventory: this.genericBaseInventory,
            b1Inventory: this.genericBaseInventory,
            finalCraft: this.finalCraft,
            recipeRegistry: this.recipeRegistry,
            quantity: this.quantity,
            config,
            logger,
            runStep: (...args) => this.#runStep(...args),
            childOptions: (...args) => this.#childOptions(...args),
            status: () => this.status()
        });
    }

    reconfigure(config = {}) {
        const next = normalizeAutomationConfig(config, this.config);
        this.config = next;
        this.inventoryState.config = next;
        this.recipeResolver.config = next;
        this.flows.b2Input.reconfigure?.({ source: next.inputSource === 'inventory' ? 'inventory' : 'storage' });
        this.baseInventory.reconfigure(next);
        this.b1Inventory.reconfigure(next);
        this.finalCraft.reconfigure(next);
        this.intermediate.reconfigure(next);
        this.reserveChain.reconfigure(next);
        this.quantity = CraftQuantityPolicy.fromConfig(next);
        this.genericBaseInventory.reconfigure?.(next);
        this.genericReserveChain.reconfigure?.(next);
        this.genericIntermediate.reconfigure?.(next);
        this.cycle.quantity = this.quantity;
        this.cycle.reconfigure?.(next);
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
     * Generic planning (CraftPlanningService) has no default target, so a
     * generic path without an explicit targetId fails closed before any
     * side effect; the legacy B5 compat view keeps its own configured
     * default and is unaffected.
     */
    run(amount = 1, { targetId = null, cancellationToken = null, operationContext = null, expectedGeneration = null, decompressionPolicy = 'unbounded', decompressionMaxUsageRatio = null, requireKnownCapacity = false } = {}) {
        const closed = this.#failClosedWhenGenericWithoutTarget(targetId);
        if (closed) return closed;
        return this.#runOperation(amount, { additional: false, targetId, cancellationToken, operationContext, expectedGeneration, mode: 'production', craftFinalTarget: true, allowNewB2: true, decompressionPolicy, decompressionMaxUsageRatio, requireKnownCapacity });
    }

    /**
     * Generic crafting-automation cycle without an explicit request target.
     * Preserved for compatibility callers (mode recovery/maintenance probes).
     * The result still carries the generic completion model below; no caller
     * may assume which item was planned when targetId is omitted.
     * Generic planning (CraftPlanningService) has no default target, so a
     * generic path without an explicit targetId fails closed before any
     * side effect; the legacy B5 compat view keeps its own configured
     * default and is unaffected.
     */
    runNext({ targetId = null, cancellationToken = null, operationContext = null, expectedGeneration = null, freshInspection = false, recoveryOnly = false, decompressionPolicy = 'unbounded', decompressionMaxUsageRatio = null, requireKnownCapacity = false } = {}) {
        const closed = this.#failClosedWhenGenericWithoutTarget(targetId);
        if (closed) return closed;
        return this.#runOperation(1, { additional: true, targetId, cancellationToken, operationContext, expectedGeneration, mode: 'production', craftFinalTarget: true, allowNewB2: true, freshInspection, recoveryOnly: recoveryOnly === true, decompressionPolicy, decompressionMaxUsageRatio, requireKnownCapacity });
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
            return this.#targetRequiredFailure('CraftingAutomation');
        }
        return this.#runOperation(1, {
            additional: true, targetId: resolvedTarget, cancellationToken, operationContext, expectedGeneration, mode: 'production',
            craftFinalTarget: true, allowNewB2: true, freshInspection, recoveryOnly: recoveryOnly === true,
            decompressionPolicy, decompressionMaxUsageRatio, requireKnownCapacity
        });
    }

    runMaintenance({ targetId = null, cancellationToken = null, operationContext = null, expectedGeneration = null, allowNewB2 = false, decompressionPolicy = 'unbounded', decompressionMaxUsageRatio = null, requireKnownCapacity = false } = {}) {
        return this.#runOperation(1, {
            additional: true, targetId, cancellationToken, operationContext, expectedGeneration,
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
        // Generic crafting-automation operation identity. Internal coordinator
        // and flow class names (generic cycle + boundary flows, legacy compat
        // reference) below are not the public contract. The public result is
        // the cycle data
        // ({ targetId, completedTarget, completedAmount } + generic blockers).
        const operationName = mode === 'maintenance' ? 'CraftingStorageMaintenance' : (additional ? 'CraftingAutomationNext' : 'CraftingAutomation');
        // The execution target travels with the request/planner/cycle options.
        // No configured default is consulted here: without an explicit
        // targetId the cycle fails closed inside #runOperation (generic) or
        // the compat planning view resolves its configured default (legacy).
        const resolvedTarget = String(targetId || '').trim() || null;
        // Slice 5: maintenance never crafts the final target, so it carries no
        // target requirement; production cycles fail closed without an explicit
        // request/planner target on the generic planning path. The legacy B5
        // compat view resolves its own configured default and is unaffected.
        if (!resolvedTarget && mode !== 'maintenance' && this.#isGenericPlanning()) {
            return this.#targetRequiredFailure(operationName);
        }
        const metadataTarget = resolvedTarget || this.config?.targetId || null;
        const operation = new Operation({
            name: operationName,
            lockKeys: ['gui', 'server-command', 'inventory', 'crafting', 'storage'],
            execute: context => this.cycle.execute(amount, context, { additional, mode, craftFinalTarget, allowNewB2, freshInspection, recoveryOnly, decompressionPolicy, decompressionMaxUsageRatio, requireKnownCapacity, targetId: resolvedTarget })
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

    // Slice 5: generic planning (CraftPlanningService) exposes plan(targetId,...);
    // the B5 compat view only exposes inspect*(amount, { targetId }).
    #isGenericPlanning() {
        return typeof this.planningService?.plan === 'function'
            || typeof this.flows?.read?.planningService?.plan === 'function';
    }

    #targetRequiredFailure(operationName) {
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
                details: { targetId: null }
            }),
            { operation: operationName, step: 'resolve-target', targetId: null }
        );
    }

    #failClosedWhenGenericWithoutTarget(targetId) {
        if (String(targetId || '').trim()) return null;
        if (!this.#isGenericPlanning()) return null;
        return this.#targetRequiredFailure('CraftingAutomation');
    }

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


    #buildGenericStack({ config, logger, inventoryCounter, recipeRegistry, craftingVerificationService }) {
        // ACT E-CUTOVER: this generic coordinator stack is the production
        // execution stack behind this.cycle. The legacy B5 coordinators built
        // above exist only for this.legacyCycle (compatibility reference).
        this.genericIntermediate = new CraftIntermediateCoordinator({
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
        this.genericBaseInventory = new CraftBaseInventoryCoordinator({
            storageFlow: this.flows.storage,
            inputAcquisition: this.flows.b2Input,
            b2Input: this.flows.b2Input,
            inventoryState: this.inventoryState,
            recipeRegistry,
            config,
            logger,
            runStep: (...args) => this.#runStep(...args),
            childOptions: (...args) => this.#childOptions(...args),
            ensureFreeIntermediateSlots: (...args) => this.genericIntermediate.ensureFreeIntermediateSlots(...args),
            verificationService: craftingVerificationService
        });
        this.genericBaseInventory.b1Inventory = this.genericBaseInventory.baseInventory;
        this.genericReserveChain = new CraftReserveChainCoordinator({
            flows: this.flows,
            inventoryState: this.inventoryState,
            inventoryCounter,
            progressTracker: this.progressTracker,
            finalCraft: this.finalCraft,
            baseInventory: this.genericBaseInventory,
            b1Inventory: this.genericBaseInventory,
            spaceFreer: this.genericIntermediate,
            intermediate: this.genericIntermediate,
            config,
            logger,
            runStep: (...args) => this.#runStep(...args),
            childOptions: (...args) => this.#childOptions(...args),
            quantityTrace: (...args) => this.#quantityTrace(...args)
        });
        this.genericReserveChain.b1Inventory = this.genericReserveChain.baseInventory;
        this.genericReserveChain.intermediate = this.genericReserveChain.spaceFreer;
        this.genericIntermediate.setReserveCoordinator(this.genericReserveChain);
    }

}

CraftAutomationService.normalizeAutomationConfig = normalizeAutomationConfig;

// Generic support/coordination modules on the production execution path
// (ACT E-CUTOVER): diagnostics, chain adapter, base-inventory, reserve chain,
// intermediate, cycle and quantity policy are all wired into this.cycle.
CraftAutomationService.CraftActionDiagnostics = require('./support/CraftActionDiagnostics');
CraftAutomationService.CraftChainAdapter = require('./support/CraftChainAdapter');
CraftAutomationService.CraftBaseInventoryCoordinator = require('./coordinators/CraftBaseInventoryCoordinator');
CraftAutomationService.CraftReserveChainCoordinator = require('./coordinators/CraftReserveChainCoordinator');
CraftAutomationService.CraftIntermediateCoordinator = require('./coordinators/CraftIntermediateCoordinator');
CraftAutomationService.CraftCycleCoordinator = CraftCycleCoordinator;
CraftAutomationService.CraftQuantityPolicy = CraftQuantityPolicy;

module.exports = CraftAutomationService;
