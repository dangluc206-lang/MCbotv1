'use strict';

const CraftStageClassifier = require('../../planning/crafting/CraftStageClassifier');
const PersonalVaultReadFlow = require('../personal-vault/PersonalVaultReadFlow');
const InventoryReadFlow = require('../inventory/InventoryReadFlow');
const { personalVaultPressure } = require('./CraftInputAvailability');
const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const FlowError = require('../../shared/errors/FlowError');
const Operation = require('../../operations/Operation');

// ponytail: cached-read TTL ceiling is 5s; raise via dataMaxAgeMs injection if profiling shows excess /kho+/pv2 reads.
const DEFAULT_DATA_MAX_AGE_MS = 5000;

/**
 * Generic crafting planning authority.
 *
 * Responsibilities (and nothing else):
 * - plan(targetId, amount, available): deterministic recipe math for an explicit target;
 * - inspect*(targetId, amount): read the current server state (/kho, /pv 2, inventory),
 *   plan against it, classify the plan stages from tier data, and derive blockers,
 *   safe action quantities and the next step.
 *
 * Every entry point receives its target from the caller: this service holds no ambient
 * or configured default target, so no generic path can silently plan one particular
 * product. There are no execution side effects here — no click, no chat, no movement,
 * no runtime event wait, no timer. Which tiers act as reserve tiers is injected policy
 * data, never a constant in this file.
 *
 * Policy keys read from `config` are tier-relative server-profile data: `supplyMode`,
 * `inputSource` ('storage' | 'inventory') and `vaultBackpressure`.
 */
class CraftPlanningService {
    constructor({
        planner,
        materialCalculator = null,
        recipeRegistry = null,
        stageClassifier = null,
        tiers = {},
        reserveTiers = [],
        storage = null,
        personalVault = null,
        inventoryReader = null,
        inventoryCounter = null,
        storageMaterials = null,
        readFlows = {},
        config = {},
        dataMaxAgeMs = DEFAULT_DATA_MAX_AGE_MS
    } = {}) {
        if (!planner?.plan) {
            throw new TypeError('CraftPlanningService planner.plan is required.');
        }

        Object.assign(this, {
            planner,
            materialCalculator,
            recipeRegistry,
            storageMaterials,
            inventoryCounter,
            tiers: tiers || {},
            config: config || {},
            dataMaxAgeMs
        });
        this.stageClassifier = stageClassifier || new CraftStageClassifier({ tiers: this.tiers, reserveTiers });
        this.readFlows = Object.freeze({
            storage: readFlows.storage || (storage?.read ? storage : null),
            personalVault: readFlows.personalVault || (personalVault?.read
                ? new PersonalVaultReadFlow({ personalVault, config: { preferData: true, maxAgeMs: dataMaxAgeMs } })
                : null),
            inventory: readFlows.inventory || (inventoryReader ? new InventoryReadFlow({ inventoryReader }) : null)
        });
    }

    plan(targetId, amount, available = {}) {
        return this.planner.plan(this.#requiredTarget(targetId), amount, available);
    }

    inspect(targetId, amount = 1, options = {}) {
        return this.#inspect(targetId, amount, { ...options, additional: false });
    }

    inspectAdditional(targetId, amount = 1, options = {}) {
        return this.#inspect(targetId, amount, { ...options, additional: true });
    }

    inspectAdditionalFresh(targetId, amount = 1, options = {}) {
        return this.#inspect(targetId, amount, { ...options, additional: true, fresh: true });
    }

    async #inspect(targetId, amount, {
        additional,
        fresh = false,
        cancellationToken = null,
        operationContext = null,
        expectedGeneration = null
    }) {
        const target = this.#requiredTarget(targetId);

        if (!this.readFlows.storage?.read || !this.readFlows.personalVault?.read
            || !this.readFlows.inventory?.readViews || !this.inventoryCounter?.count) {
            throw new TypeError('CraftPlanningService inspection requires storage, personal vault, inventory and counter capabilities.');
        }

        try {
            const readOptions = {
                cancellationToken,
                operationContext,
                expectedGeneration,
                preferData: !fresh,
                maxAgeMs: fresh ? 0 : this.dataMaxAgeMs
            };
            const storageResult = await this.readFlows.storage.read(readOptions);
            if (storageResult?.success === false) return this.#contextualize(storageResult, {
                code: 'CRAFT_PLAN_STORAGE_READ_FAILED', step: 'read-storage', action: 'read /kho', resource: 'storage'
            });
            const vaultResult = await this.readFlows.personalVault.read(readOptions);
            if (vaultResult?.success === false) return this.#contextualize(vaultResult, {
                code: 'CRAFT_PLAN_VAULT_READ_FAILED', step: 'read-personal-vault', action: 'read /pv 2', resource: 'personal-vault'
            });

            const inventoryViews = this.readFlows.inventory.readViews() || [];
            const inventory = this.#primaryInventoryView(inventoryViews);
            const counted = this.#countInventory(inventoryViews, this.#knownIds(target));
            const vaultTotals = { ...(vaultResult.data?.totals || {}) };
            const inventoryTotals = { ...counted.totals };
            if (additional) {
                // An additional unit is planned on top of what is already owned.
                delete vaultTotals[target];
                delete inventoryTotals[target];
            }

            const nonStorageAvailable = this.#mergeCounts(vaultTotals, inventoryTotals);
            const effectiveStorageItems = this.#effectiveStorageItems(storageResult.data);
            const craftableStorageItems = this.#craftableStorageItems(storageResult.data, effectiveStorageItems);
            const allAvailable = this.#mergeCounts(nonStorageAvailable, craftableStorageItems);

            const planWithoutStorage = this.plan(target, amount, nonStorageAvailable);
            const fullPlan = this.plan(target, amount, allAvailable);
            const reserved = this.stageClassifier.partition(planWithoutStorage);
            const fullPlanPartition = this.stageClassifier.partition(fullPlan);
            const chains = this.#buildChains({ planWithoutStorage, storageSnapshot: storageResult.data, craftableStorageItems, effectiveStorageItems, vaultSnapshot: vaultResult.data, inventoryTotals });
            const progress = this.#buildProgress({
                amount,
                additional,
                fullPlan,
                finalSteps: fullPlanPartition.finalSteps,
                chains,
                nonStorageAvailable,
                vaultTotals,
                inventoryTotals
            });

            return Result.ok(Object.freeze({
                targetId: target,
                amount,
                additional: Boolean(additional),
                fresh: Boolean(fresh),
                storage: storageResult.data,
                effectiveStorageItems,
                craftableStorageItems,
                personalVault: vaultResult.data,
                personalVaultPressure: personalVaultPressure(vaultResult.data, this.config?.vaultBackpressure),
                supplyPolicy: Object.freeze({ mode: String(this.config?.supplyMode || 'finite').toLowerCase() }),
                inventory,
                inventoryViews,
                inventoryTotals: counted.totals,
                inventoryTotalsBySource: counted.bySource,
                nonStorageAvailable,
                allAvailable,
                planWithoutStorage,
                fullPlan,
                reserveSteps: reserved.reserveSteps,
                finalSteps: fullPlanPartition.finalSteps,
                chains,
                progress
            }));
        } catch (error) {
            const wrapped = FlowError.wrap(error, {
                code: 'CRAFT_PLANNING_FAILED', subsystem: 'craft-planning', operation: 'CraftPlanningService',
                step: 'calculate-plan', action: additional ? 'inspect additional target' : 'inspect target',
                resource: target, details: { amount, additional, targetId: target }
            });
            return Result.fail(Operation.statusForError(wrapped), wrapped.message, wrapped, wrapped.toDiagnostic());
        }
    }

    #requiredTarget(targetId) {
        const resolved = String(targetId ?? '').trim();
        if (!resolved) throw new TypeError('CraftPlanningService targetId is required.');
        return resolved;
    }

    #contextualize(result, context) {
        if (result?.success !== false) return result;
        const wrapped = FlowError.wrap(result.error || new Error(result.message || 'Craft planning dependency failed.'), {
            subsystem: 'craft-planning', operation: 'CraftPlanningService', ...context,
            details: { ...(result.meta || {}), ...(context.details || {}) }
        });
        return Result.fail(result.status || Status.FAILED, wrapped.message, wrapped, wrapped.toDiagnostic());
    }

    #primaryInventoryView(views) {
        return views.find(view => view?.source === 'current-window')
            || views.find(view => view?.source === 'bot-inventory')
            || views[0]
            || null;
    }

    #countInventory(views, knownIds) {
        const totals = {};
        const bySource = {};
        for (const id of knownIds) {
            let best = 0;
            for (const view of views) {
                if (!view) continue;
                const count = this.inventoryCounter.count(view, id);
                if (!bySource[view.source]) bySource[view.source] = {};
                if (count > 0) bySource[view.source][id] = count;
                best = Math.max(best, Number(count) || 0);
            }
            if (best > 0) totals[id] = best;
        }
        return { totals, bySource };
    }

    #knownIds(targetId) {
        // A raw tier has no producing recipe; its items only count as available
        // material when the profile sources base input from inventory.
        const includeRawTier = String(this.config?.inputSource || 'storage').toLowerCase() === 'inventory';
        const ids = new Set();
        for (const tierIds of Object.values(this.tiers || {})) {
            if (!includeRawTier && this.#isRawTier(tierIds)) continue;
            for (const id of tierIds || []) ids.add(id);
        }
        ids.add(targetId);
        return ids;
    }

    #isRawTier(tierIds) {
        const ids = tierIds || [];
        if (ids.length === 0) return false;
        return ids.every(id => !this.#recipeForOutput(id));
    }

    #effectiveStorageItems(snapshot) {
        if (this.storageMaterials?.effectiveItems) return this.storageMaterials.effectiveItems(snapshot?.items || {});
        return { ...(snapshot?.items || {}) };
    }

    #craftableStorageItems(snapshot, effectiveItems) {
        if (this.storageMaterials?.craftableItems) return this.storageMaterials.craftableItems(snapshot || {});
        return { ...effectiveItems };
    }

    #mergeCounts(...sources) {
        const output = {};
        for (const source of sources) {
            for (const [id, count] of Object.entries(source || {})) {
                const value = Number(count || 0);
                if (value > 0) output[id] = (output[id] || 0) + value;
            }
        }
        return output;
    }

    #recipeForOutput(outputId) {
        const wanted = String(outputId || '').trim();
        if (!wanted || !this.recipeRegistry?.ids) return null;
        for (const recipeId of this.recipeRegistry.ids()) {
            const recipe = this.recipeRegistry.require(recipeId);
            if (recipe?.output === wanted) return { recipeId, recipe };
        }
        return null;
    }

    /**
     * Reserve chains are derived structurally from the recipe graph, in tier-table
     * order: a single-input output whose single input is itself produced from a single
     * base material. No item, tier or product name is hard-coded here.
     */
    #buildChains({ planWithoutStorage, storageSnapshot, craftableStorageItems, effectiveStorageItems, vaultSnapshot, inventoryTotals }) {
        const craftsByOutput = new Map((planWithoutStorage?.steps || []).map(step => [step.outputId, step]));
        const chains = [];

        for (const outputId of this.#candidateOutputIds()) {
            const outputRecipe = this.#recipeForOutput(outputId);
            if (!outputRecipe) continue;
            const inputs = Object.entries(outputRecipe.recipe.inputs || {}).filter(([, count]) => Number(count) > 0);
            if (inputs.length !== 1) continue;
            const [intermediateId, intermediatePerOutput] = inputs[0];
            const intermediateRecipe = this.#recipeForOutput(intermediateId);
            if (!intermediateRecipe) continue;

            const baseRequirements = this.materialCalculator?.requirements?.(outputId, 1) || {};
            const baseIds = Object.keys(baseRequirements);
            if (baseIds.length !== 1) continue;
            const baseId = baseIds[0];

            const baseNeededFromStorage = Number(planWithoutStorage?.missing?.[baseId] || 0);
            const inventoryBase = String(this.config?.inputSource || 'storage').toLowerCase() === 'inventory'
                ? Math.max(0, Number(inventoryTotals?.[baseId] || 0))
                : 0;
            const storageEffective = Number(craftableStorageItems?.[baseId] || 0);
            const storageTotalEffective = Number(effectiveStorageItems?.[baseId] || 0);
            const storedEffective = storageEffective + inventoryBase;
            const storedTotalEffective = storageTotalEffective + inventoryBase;
            // The non-storage plan already consumed inventory base material; only storage
            // may satisfy its remaining missing amount, otherwise leftovers from an
            // earlier batch would be counted twice.
            const immediateMissingRaw = Math.max(0, baseNeededFromStorage - storageEffective);
            const missingRaw = Math.max(0, baseNeededFromStorage - storedTotalEffective);
            const intermediateCrafts = Number(craftsByOutput.get(intermediateId)?.crafts || 0);
            const outputCrafts = Number(craftsByOutput.get(outputId)?.crafts || 0);

            chains.push(Object.freeze({
                baseId,
                intermediateId,
                outputId,
                intermediateRecipeId: intermediateRecipe.recipeId,
                outputRecipeId: outputRecipe.recipeId,
                intermediateOutputAmount: Number(intermediateRecipe.recipe.outputAmount || 1),
                intermediatePerOutput: Number(intermediatePerOutput || 0),
                basePerOutput: Number(baseRequirements[baseId] || 0),
                baseNeededFromStorage,
                storedLoose: Number(storageSnapshot?.items?.[baseId] || 0),
                inventoryBase,
                storageEffective,
                storageTotalEffective,
                storedEffective,
                storedTotalEffective,
                decompressionBlocked: storedTotalEffective > storedEffective,
                immediateMissingRaw,
                missingRaw,
                readyToReserve: missingRaw === 0,
                intermediateCrafts,
                outputCrafts,
                vaultIntermediate: Number(vaultSnapshot?.totals?.[intermediateId] || 0),
                vaultOutput: Number(vaultSnapshot?.totals?.[outputId] || 0),
                inventoryIntermediate: Number(inventoryTotals?.[intermediateId] || 0),
                inventoryOutput: Number(inventoryTotals?.[outputId] || 0)
            }));
        }

        return Object.freeze(chains);
    }

    // Tier-table order keeps chain enumeration deterministic and profile-driven.
    #candidateOutputIds() {
        const ordered = [];
        const seen = new Set();
        for (const tierIds of Object.values(this.tiers || {})) {
            for (const id of tierIds || []) {
                const key = String(id || '').trim();
                if (!key || seen.has(key)) continue;
                seen.add(key);
                ordered.push(key);
            }
        }
        return ordered;
    }

    #buildProgress({ amount, additional, fullPlan, finalSteps, chains, nonStorageAvailable, vaultTotals, inventoryTotals }) {
        const targetId = fullPlan?.targetId || null;
        const targetAmount = Math.max(1, Number(amount || 1));
        const directInputs = this.#directInputs(targetId, targetAmount, nonStorageAvailable, finalSteps);
        const reserve = this.#reserveEntries(chains);

        const targetDirectReady = directInputs.length > 0 && directInputs.every(entry => entry.available >= entry.required);
        const craftableDirectInputs = directInputs.filter(entry => entry.craftableNow > 0);
        const craftableMissingFirst = [
            ...craftableDirectInputs.filter(entry => entry.missing > 0),
            ...craftableDirectInputs.filter(entry => entry.missing <= 0)
        ];
        const promotableReserve = reserve.filter(entry => entry.promotableFromOwned > 0);
        const reserveStages = (chains || []).reduce((count, chain) =>
            count + (Number(chain.intermediateCrafts || 0) > 0 ? 1 : 0) + (Number(chain.outputCrafts || 0) > 0 ? 1 : 0), 0);
        const finalStages = (finalSteps || []).filter(step => Number(step?.crafts || 0) > 0).length;
        const completionStages = finalStages > 0 || targetDirectReady ? 2 : 0;
        const remainingStages = targetDirectReady ? 3 : reserveStages + finalStages + completionStages;
        const remainingCrafts = (chains || []).reduce((sum, chain) =>
            sum + Math.max(0, Number(chain.intermediateCrafts || 0)) + Math.max(0, Number(chain.outputCrafts || 0)), 0)
            + (finalSteps || []).reduce((sum, step) => sum + Math.max(0, Number(step?.crafts || 0)), 0);

        const nextStep = this.#nextStep({ targetId, targetAmount, targetDirectReady, craftableMissingFirst, promotableReserve, chains, finalSteps });
        const missingBase = Object.fromEntries(Object.entries(fullPlan?.missing || {})
            .filter(([, count]) => Number(count || 0) > 0)
            .map(([id, count]) => [id, Number(count)]));
        const feasible = Boolean(fullPlan?.feasible);

        return Object.freeze({
            targetId,
            amount: targetAmount,
            additional: Boolean(additional),
            feasible,
            state: this.#stateFor({ feasible, targetDirectReady, craftableMissingFirst, promotableReserve, remainingStages }),
            targetDirectReady,
            directInputs: Object.freeze(directInputs),
            directInputCraftableTotal: craftableDirectInputs.reduce((sum, entry) => sum + entry.craftableNow, 0),
            reserve: Object.freeze(reserve),
            reserveMissingTotal: reserve.reduce((sum, entry) => sum + entry.missingCrafts, 0),
            reservePromotableTotal: promotableReserve.reduce((sum, entry) => sum + entry.promotableFromOwned, 0),
            targetExisting: Math.max(0, Number(vaultTotals?.[targetId] || 0) + Number(inventoryTotals?.[targetId] || 0)),
            reserveStages,
            finalStages,
            remainingStages,
            remainingCrafts,
            nextStep,
            missingBase: Object.freeze(missingBase)
        });
    }

    #stateFor({ feasible, targetDirectReady, craftableMissingFirst, promotableReserve, remainingStages }) {
        if (targetDirectReady) return 'TARGET_READY';
        if (craftableMissingFirst.length > 0) return 'DIRECT_INPUT_READY';
        if (promotableReserve.length > 0) return 'RESERVE_COMPACTING';
        if (feasible && remainingStages === 0) return 'READY_TO_VERIFY';
        return feasible ? 'READY' : 'WAITING_MATERIALS';
    }

    #directInputs(targetId, targetAmount, available, finalSteps) {
        const entry = this.#recipeForOutput(targetId);
        return Object.entries(entry?.recipe?.inputs || {}).map(([id, perTarget]) => {
            const required = Math.max(0, Number(perTarget || 0) * targetAmount);
            const availableCount = Math.max(0, Number(available?.[id] || 0));
            const step = (finalSteps || []).find(candidate => candidate?.outputId === id) || null;
            return Object.freeze({
                id,
                required,
                available: availableCount,
                missing: Math.max(0, required - availableCount),
                plannedCrafts: Math.max(0, Number(step?.crafts || 0)),
                craftableNow: this.#craftableNow(id, available)
            });
        });
    }

    // How many of `id` the currently available inputs allow right now.
    #craftableNow(id, available) {
        const entry = this.#recipeForOutput(id);
        const inputs = Object.entries(entry?.recipe?.inputs || {}).filter(([, count]) => Number(count) > 0);
        if (!entry || inputs.length === 0) return 0;
        const limit = Math.min(...inputs.map(([inputId, count]) =>
            Math.floor(Math.max(0, Number(available?.[inputId] || 0)) / Number(count))));
        return Number.isFinite(limit) ? Math.max(0, limit) : 0;
    }

    #reserveEntries(chains) {
        return (chains || []).map(chain => {
            const ownedIntermediate = Math.max(0, Number(chain.vaultIntermediate || 0) + Number(chain.inventoryIntermediate || 0));
            const perOutput = Math.max(1, Number(chain.intermediatePerOutput || 1));
            return Object.freeze({
                id: chain.outputId,
                intermediateId: chain.intermediateId,
                missingCrafts: Math.max(0, Number(chain.outputCrafts || 0)),
                available: Math.max(0, Number(chain.vaultOutput || 0) + Number(chain.inventoryOutput || 0)),
                intermediateCrafts: Math.max(0, Number(chain.intermediateCrafts || 0)),
                ownedIntermediate,
                promotableFromOwned: Math.max(0, Math.floor(ownedIntermediate / perOutput)),
                waitingRaw: Math.max(0, Number(chain.missingRaw || 0))
            });
        });
    }

    /**
     * Next executable step, ordered by need: finish the target, craft a directly required
     * input, compact owned reserves, then build reserve stock from base material.
     * Kinds are generic action roles; consumers translate them to their own vocabulary.
     */
    #nextStep({ targetId, targetAmount, targetDirectReady, craftableMissingFirst, promotableReserve, chains, finalSteps }) {
        if (targetDirectReady) return Object.freeze({ kind: 'TARGET', id: targetId, crafts: targetAmount });
        if (craftableMissingFirst.length > 0) {
            const entry = craftableMissingFirst[0];
            return Object.freeze({
                kind: 'DIRECT_INPUT',
                id: entry.id,
                crafts: entry.missing > 0 ? Math.min(entry.missing, entry.craftableNow) : entry.craftableNow,
                reason: entry.missing > 0 ? 'target-priority' : 'storage-compaction'
            });
        }
        if (promotableReserve.length > 0) {
            const entry = promotableReserve[0];
            return Object.freeze({
                kind: 'COMPACT_RESERVE',
                id: entry.id,
                crafts: entry.promotableFromOwned,
                intermediateId: entry.intermediateId,
                reason: 'compress-owned-intermediate'
            });
        }
        const fromChain = this.#chainStep(chains);
        if (fromChain) return fromChain;
        const step = (finalSteps || []).find(candidate => Number(candidate?.crafts || 0) > 0);
        if (!step) return null;
        return Object.freeze({
            kind: step.outputId === targetId ? 'TARGET' : 'DIRECT_INPUT',
            id: step.outputId,
            recipeId: step.recipeId,
            crafts: Number(step.crafts || 0)
        });
    }

    #chainStep(chains) {
        for (const chain of chains || []) {
            const intermediateCrafts = Number(chain.intermediateCrafts || 0);
            const outputCrafts = Number(chain.outputCrafts || 0);
            if (outputCrafts > 0 && intermediateCrafts <= 0) {
                return Object.freeze({ kind: 'RESERVE_CRAFT', id: chain.outputId, crafts: outputCrafts });
            }
            if (intermediateCrafts > 0) {
                const needsBasePreparation = Number(chain.immediateMissingRaw || 0) > 0
                    && Number(chain.missingRaw || 0) <= 0;
                if (!needsBasePreparation) {
                    return Object.freeze({
                        kind: 'INTERMEDIATE_CHAIN',
                        outputId: chain.outputId,
                        intermediateId: chain.intermediateId,
                        intermediateCrafts,
                        outputCrafts
                    });
                }
                return Object.freeze({
                    kind: 'PREPARE_BASE',
                    baseId: chain.baseId,
                    intermediateId: chain.intermediateId,
                    outputId: chain.outputId,
                    intermediateCrafts,
                    reason: chain.decompressionBlocked ? 'decompression-headroom' : 'prepare-base-form'
                });
            }
        }
        return null;
    }
}

module.exports = CraftPlanningService;
