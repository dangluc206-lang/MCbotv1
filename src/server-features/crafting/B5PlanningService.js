'use strict';

const Result = require('../../shared/result/Result');
const CraftStageClassifier = require('../../planning/crafting/CraftStageClassifier');

// Legacy B5 vocabulary. This compat boundary owns the translation between the generic
// crafting planning contract and the names its remaining consumers (B5 automation,
// collector-B5 mode, trace/replay artifacts) still read. It holds no planning logic:
// reads, recipe math, stage classification and progress come from CraftPlanningService,
// and the compiled execution plan comes from the injected execution planner.
const STATE_ALIASES = Object.freeze({
    TARGET_READY: 'B5_READY',
    DIRECT_INPUT_READY: 'B4_READY',
    RESERVE_COMPACTING: 'B3_COMPACTING'
});
const REASON_ALIASES = Object.freeze({
    'target-priority': 'b5-priority',
    'compress-owned-intermediate': 'compress-owned-b2'
});

class B5PlanningService {
    constructor({ planning, tiers = {}, targetId, reserveTiers = ['B2', 'B3'], executionPlanner = null } = {}) {
        if (!planning?.inspect || !planning?.inspectAdditional || !planning?.inspectAdditionalFresh) {
            throw new TypeError('B5PlanningService generic planning service is required.');
        }
        const configuredTarget = String(targetId || '').trim();
        if (!configuredTarget) {
            throw new TypeError('B5PlanningService targetId is required: it must come from configuration, never a code default.');
        }

        this.planning = planning;
        this.targetId = configuredTarget;
        this.executionPlanner = executionPlanner;
        // Which tiers this consumer treats as compressed reserve stock stays B5 boundary
        // policy; the classification itself is the shared generic classifier.
        this.stageClassifier = new CraftStageClassifier({ tiers, reserveTiers });
    }

    inspect(amount = 1, options = {}) {
        return this.#inspect(amount, { ...options, additional: false });
    }

    inspectAdditional(amount = 1, options = {}) {
        return this.#inspect(amount, { ...options, additional: true });
    }

    inspectAdditionalFresh(amount = 1, options = {}) {
        return this.#inspect(amount, { ...options, additional: true, fresh: true });
    }

    // Legacy callers may pass their own target; otherwise the configured B5 target
    // applies here. The generic service itself never defaults a target.
    #target(targetId) {
        return String(targetId || this.targetId).trim();
    }

    async #inspect(amount, { additional, fresh = false, targetId = null, ...options }) {
        const target = this.#target(targetId);
        const result = await this.#delegate(target, amount, { additional, fresh, options });
        if (result?.success === false) return result;

        const inspection = this.#legacyView(result.data);
        inspection.executionPlan = this.executionPlanner?.compile?.(inspection) || null;
        return Result.ok(inspection);
    }

    #delegate(target, amount, { additional, fresh, options }) {
        if (!fresh) {
            return additional
                ? this.planning.inspectAdditional(target, amount, options)
                : this.planning.inspect(target, amount, options);
        }
        return additional
            ? this.planning.inspectAdditionalFresh(target, amount, options)
            : this.planning.inspect(target, amount, { ...options, fresh: true });
    }

    // Generic inspection -> legacy B5 inspection view (same data, legacy names).
    #legacyView(inspection) {
        const withheld = this.stageClassifier.partition(inspection.planWithoutStorage);
        const full = this.stageClassifier.partition(inspection.fullPlan);
        return {
            amount: inspection.amount,
            additional: inspection.additional,
            storage: inspection.storage,
            effectiveStorageItems: inspection.effectiveStorageItems,
            craftableStorageItems: inspection.craftableStorageItems,
            personalVault: inspection.personalVault,
            personalVaultPressure: inspection.personalVaultPressure,
            b1Supply: inspection.supplyPolicy,
            inventory: inspection.inventory,
            inventoryViews: inspection.inventoryViews,
            inventoryTotals: inspection.inventoryTotals,
            inventoryTotalsBySource: inspection.inventoryTotalsBySource,
            nonStorageAvailable: inspection.nonStorageAvailable,
            allAvailable: inspection.allAvailable,
            planWithoutStorage: inspection.planWithoutStorage,
            fullPlan: inspection.fullPlan,
            reserveSteps: withheld.reserveSteps,
            finalSteps: full.finalSteps,
            chains: (inspection.chains || []).map(chain => this.#legacyChain(chain)),
            progress: this.#legacyProgress(inspection.progress),
            fresh: inspection.fresh
        };
    }

    #legacyChain(chain) {
        return {
            baseId: chain.baseId,
            b2Id: chain.intermediateId,
            b3Id: chain.outputId,
            b2RecipeId: chain.intermediateRecipeId,
            b3RecipeId: chain.outputRecipeId,
            b2OutputAmount: chain.intermediateOutputAmount,
            b3InputPerCraft: chain.intermediatePerOutput,
            rawPerB3: chain.basePerOutput,
            rawNeededFromStorage: chain.baseNeededFromStorage,
            storedLoose: chain.storedLoose,
            inventoryB1: chain.inventoryBase,
            storageEffective: chain.storageEffective,
            storageTotalEffective: chain.storageTotalEffective,
            storedEffective: chain.storedEffective,
            storedTotalEffective: chain.storedTotalEffective,
            decompressionBlocked: chain.decompressionBlocked,
            immediateMissingRaw: chain.immediateMissingRaw,
            missingRaw: chain.missingRaw,
            readyToReserve: chain.readyToReserve,
            b2Crafts: chain.intermediateCrafts,
            b3Crafts: chain.outputCrafts,
            vaultB2: chain.vaultIntermediate,
            vaultB3: chain.vaultOutput,
            inventoryB2: chain.inventoryIntermediate,
            inventoryB3: chain.inventoryOutput
        };
    }

    #legacyProgress(progress) {
        return {
            targetId: progress.targetId,
            amount: progress.amount,
            additional: progress.additional,
            feasible: progress.feasible,
            state: STATE_ALIASES[progress.state] || progress.state,
            b5DirectReady: progress.targetDirectReady,
            b3: (progress.reserve || []).map(entry => ({
                id: entry.id,
                b2Id: entry.intermediateId,
                missingCrafts: entry.missingCrafts,
                available: entry.available,
                b2Crafts: entry.intermediateCrafts,
                ownedB2: entry.ownedIntermediate,
                promotableFromOwnedB2: entry.promotableFromOwned,
                waitingRaw: entry.waitingRaw
            })),
            b3MissingTotal: progress.reserveMissingTotal,
            b3PromotableTotal: progress.reservePromotableTotal,
            b4: (progress.directInputs || []).map(entry => ({
                id: entry.id,
                required: entry.required,
                available: entry.available,
                missing: entry.missing,
                plannedCrafts: entry.plannedCrafts,
                craftableNow: entry.craftableNow
            })),
            b4CraftableTotal: progress.directInputCraftableTotal,
            targetExisting: progress.targetExisting,
            reserveStages: progress.reserveStages,
            finalStages: progress.finalStages,
            remainingStages: progress.remainingStages,
            remainingCrafts: progress.remainingCrafts,
            nextStep: this.#legacyStep(progress.nextStep),
            missingBase: { ...(progress.missingBase || {}) }
        };
    }

    #legacyStep(step) {
        if (!step) return null;
        switch (step.kind) {
            case 'TARGET':
                return this.#compact({ kind: 'B5', id: step.id, crafts: step.crafts, recipeId: step.recipeId });
            case 'DIRECT_INPUT':
                return this.#compact({
                    kind: 'B4', id: step.id, crafts: step.crafts,
                    recipeId: step.recipeId, reason: this.#legacyReason(step.reason)
                });
            case 'COMPACT_RESERVE':
                return this.#compact({
                    kind: 'B3', id: step.id, crafts: step.crafts,
                    from: step.intermediateId, reason: this.#legacyReason(step.reason)
                });
            case 'RESERVE_CRAFT':
                return this.#compact({ kind: 'B3', id: step.id, crafts: step.crafts });
            case 'PREPARE_BASE':
                return this.#compact({
                    kind: 'PREPARE_B1',
                    id: step.baseId,
                    b2Id: step.intermediateId,
                    b3Id: step.outputId,
                    b2Crafts: step.intermediateCrafts,
                    reason: this.#legacyReason(step.reason)
                });
            case 'INTERMEDIATE_CHAIN':
                return this.#compact({
                    kind: 'B2/B3',
                    id: step.outputId,
                    b2Id: step.intermediateId,
                    b2Crafts: step.intermediateCrafts,
                    b3Crafts: step.outputCrafts
                });
            default:
                return { ...step };
        }
    }

    #legacyReason(reason) {
        return reason ? (REASON_ALIASES[reason] || reason) : undefined;
    }

    // Absent legacy fields must stay absent: consumers branch on key presence.
    #compact(step) {
        return Object.fromEntries(Object.entries(step).filter(([, value]) => value !== undefined));
    }
}

module.exports = B5PlanningService;
