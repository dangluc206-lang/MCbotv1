'use strict';

const Operation = require('../../operations/Operation');
const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const FlowError = require('../../shared/errors/FlowError');
const CraftReadFlow = require('./flows/CraftReadFlow');
const B5PlanningFlow = require('./b5/flows/B5PlanningFlow');
const B5StorageFlow = require('./b5/flows/B5StorageFlow');
const CraftWithdrawFlow = require('./flows/CraftWithdrawFlow');
const CraftCraftFlow = require('./flows/CraftCraftFlow');
const B2InputAcquisitionFlow = require('./b5/flows/B2InputAcquisitionFlow');
const CraftProgressTracker = require('./support/CraftProgressTracker');
const CraftInventoryState = require('./support/CraftInventoryState');
const CraftRecipeResolver = require('./support/CraftRecipeResolver');
const B5B1InventoryCoordinator = require('./b5/B5B1InventoryCoordinator');
const CraftBaseInventoryCoordinator = require('./coordinators/CraftBaseInventoryCoordinator');
const CraftFinalCraftCoordinator = require('./coordinators/CraftFinalCraftCoordinator');
const CraftIntermediateCoordinator = require('./coordinators/CraftIntermediateCoordinator');
const B5IntermediateCoordinator = require('./b5/B5IntermediateCoordinator');
const B5ReserveChainCoordinator = require('./b5/B5ReserveChainCoordinator');
const CraftReserveChainCoordinator = require('./coordinators/CraftReserveChainCoordinator');
const CraftCycleCoordinator = require('./coordinators/CraftCycleCoordinator');
const CraftQuantityPolicy = require('./support/CraftQuantityPolicy');
const B5CycleCoordinator = require('./b5/B5CycleCoordinator');
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
        quantity = null,
        craftingVerificationService
    }) {
        if (!craftingVerificationService) {
            throw new TypeError('CraftAutomationService craftingVerificationService is required.');
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
        this.progressTracker = new CraftProgressTracker({ logger });
        this.inventoryState = inventoryState || new CraftInventoryState({ inventoryReader, inventoryCounter, config });
        this.recipeResolver = new CraftRecipeResolver({ recipeRegistry, config, logger });
        // Generic quantity authority: injected by the composition root or derived
        // from config once (legacy B-chain key names are mapped at fromConfig).
        this.quantity = quantity || CraftQuantityPolicy.fromConfig(config);
        this.flows = Object.freeze({
            read: flows.read || new CraftReadFlow({ planningService, storage, personalVault, inventoryReader }),
            plan: flows.plan || new B5PlanningFlow({ recipeRegistry, config }),
            storage: flows.storage || new B5StorageFlow({ b1Materials }),
            b2Input: flows.b2Input || new B2InputAcquisitionFlow({
                storage,
                source: (config?.inputSource ?? config?.b2InputSource) === 'inventory' ? 'inventory' : 'storage'
            }),
            deposit: flows.deposit || new PersonalVaultStorageFlow({ personalVault, config: { verify: true } }),
            withdraw: flows.withdraw || new CraftWithdrawFlow({ personalVault }),
            craft: flows.craft || new CraftCraftFlow({ crafting })
        });
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
        this.#buildGenericStack({ config, logger, inventoryCounter, recipeRegistry, craftingVerificationService });
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
        // Slice 6 Step 5 (boundary work, cutover pending): the generic cycle core
        // and the generic quantity policy are implemented and boundary-tested.
        // They are not on the runtime path yet: the generic coordinators they
        // call still diverge from the locked legacy behavior on 11 cycle
        // scenarios (quantity/space/compaction), so the cutover stays open until
        // those twins reach parity. Exposed here only so the modules stay
        // runtime-reachable without changing production behavior.
        this.genericCycle = new CraftCycleCoordinator({
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
        this.genericCycle.b1Inventory = this.genericCycle.baseInventory;
    }

    reconfigure(config = {}) {
        const next = normalizeAutomationConfig(config, this.config);
        this.config = next;
        this.inventoryState.config = next;
        this.recipeResolver.config = next;
        this.flows.plan.reconfigure?.(next);
        this.flows.b2Input.reconfigure?.({ source: next.inputSource === 'inventory' ? 'inventory' : 'storage' });
        this.b1Inventory.reconfigure(next);
        this.finalCraft.reconfigure(next);
        this.intermediate.reconfigure(next);
        this.reserveChain.reconfigure(next);
        this.cycle.reconfigure(next);
        this.quantity = CraftQuantityPolicy.fromConfig(next);
        this.genericBaseInventory.reconfigure?.(next);
        this.genericReserveChain.reconfigure?.(next);
        this.genericIntermediate.reconfigure?.(next);
        this.genericCycle.quantity = this.quantity;
        this.genericCycle.reconfigure?.(next);
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
        // Generic crafting-automation operation identity. Internal B5
        // coordinators/flows below keep their names; they are not the public
        // contract. The public result is the cycle data
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
        // ACT A: detached generic coordinator stack (composition-only). Production stays on this.cycle (B5).
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

// Slice 6 Step 1: generic diagnostics + chain-field adapter are implemented and
// unit-tested, but no coordinator execution path uses them yet (cutover is
// Step 2+). Exposed here (not on the execution path) so the modules stay
// runtime-reachable without changing production behavior.
CraftAutomationService.CraftActionDiagnostics = require('./support/CraftActionDiagnostics');
CraftAutomationService.CraftChainAdapter = require('./support/CraftChainAdapter');
// Slice 6 Step 2: generic base-inventory leaf is implemented and boundary-tested
// (parity with the legacy coordinator on neutral fixtures). Still not wired
// into any runtime cycle; exposed here only so the module stays
// runtime-reachable without changing production behavior.
CraftAutomationService.CraftBaseInventoryCoordinator = require('./coordinators/CraftBaseInventoryCoordinator');
// Slice 6 Step 3: generic reserve core is implemented and boundary-tested
// (parity with the legacy coordinator on neutral fixtures). Still not wired
// into any runtime cycle; exposed here only so the module stays
// runtime-reachable without changing production behavior.
CraftAutomationService.CraftReserveChainCoordinator = require('./coordinators/CraftReserveChainCoordinator');
// Slice 6 Step 4 (work in progress): generic intermediate core, boundary-tested only.
CraftAutomationService.CraftIntermediateCoordinator = require('./coordinators/CraftIntermediateCoordinator');
// Slice 6 Step 5 (boundary work, cutover pending): generic cycle core + generic
// quantity policy. Exposed here (not on the execution path) so the modules stay
// runtime-reachable without changing production behavior.
CraftAutomationService.CraftCycleCoordinator = CraftCycleCoordinator;
CraftAutomationService.CraftQuantityPolicy = CraftQuantityPolicy;

module.exports = CraftAutomationService;
