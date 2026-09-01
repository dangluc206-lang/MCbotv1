'use strict';

const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const FlowError = require('../../shared/errors/FlowError');
const Operation = require('../../operations/Operation');
const B5KhoReadFlow = require('./b5/flows/B5KhoReadFlow');
const PersonalVaultReadFlow = require('../personal-vault/PersonalVaultReadFlow');
const InventoryReadFlow = require('../inventory/InventoryReadFlow');

class B5PlanningService {
    constructor({
        storage,
        personalVault,
        inventoryReader,
        inventoryCounter,
        b5Planner,
        materialCalculator,
        recipeRegistry,
        tiers,
        b1Materials = null,
        executionPlanner = null,
        config = null,
        guiDataMaxAgeMs = 5000,
        readFlows = {}
    }) {
        Object.assign(this, {
            storage,
            personalVault,
            inventoryReader,
            inventoryCounter,
            b5Planner,
            materialCalculator,
            recipeRegistry,
            tiers,
            b1Materials,
            executionPlanner,
            config: config || {},
            guiDataMaxAgeMs
        });
        this.readFlows = Object.freeze({
            kho: readFlows.kho || new B5KhoReadFlow({ storage }),
            pv2: readFlows.pv2 || new PersonalVaultReadFlow({ personalVault, config: { preferData: true, maxAgeMs: guiDataMaxAgeMs } }),
            inventory: readFlows.inventory || new InventoryReadFlow({ inventoryReader })
        });
        this.craftPlanningService = new CraftPlanningService({
            planner: this.b5Planner,
            defaultTargetId: this.config.targetId
        });
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

    async #inspect(amount, {
        additional,
        fresh = false,
        cancellationToken = null,
        operationContext = null,
        expectedGeneration = null
    }) {
        try {
            const childOptions = {
                cancellationToken,
                operationContext,
                expectedGeneration,
                preferData: !fresh,
                maxAgeMs: fresh ? 0 : this.guiDataMaxAgeMs
            };
            const storageResult = await this.readFlows.kho.read(childOptions);
            if (!storageResult.success) return this.#contextualize(storageResult, {
                code: 'B5_PLAN_STORAGE_READ_FAILED', step: 'read-storage', action: 'read /kho', resource: 'B1'
            });
            const vaultResult = await this.readFlows.pv2.read(childOptions);
            if (!vaultResult.success) return this.#contextualize(vaultResult, {
                code: 'B5_PLAN_PV_READ_FAILED', step: 'read-personal-vault', action: 'read /pv 2', resource: 'B2-B5'
            });

            const inventoryViews = this.readFlows.inventory.readViews();
            const inventorySnapshot = inventoryViews.find(view => view?.source === 'current-window')
                || inventoryViews.find(view => view?.source === 'bot-inventory')
                || inventoryViews[0];
            const knownIds = this.#knownIds();
            const inventoryTotals = {};
            const inventoryTotalsBySource = {};
            for (const id of knownIds) {
                let best = 0;
                for (const snapshot of inventoryViews) {
                    if (!snapshot) continue;
                    const count = this.inventoryCounter.count(snapshot, id);
                    if (!inventoryTotalsBySource[snapshot.source]) inventoryTotalsBySource[snapshot.source] = {};
                    if (count > 0) inventoryTotalsBySource[snapshot.source][id] = count;
                    best = Math.max(best, count);
                }
                if (best > 0) inventoryTotals[id] = best;
            }

            const personalVaultPressure = this.#personalVaultPressure(vaultResult.data);
            const vaultTotals = { ...(vaultResult.data?.totals || {}) };
            const effectiveInventoryTotals = { ...inventoryTotals };
            if (additional) {
                delete vaultTotals[this.b5Planner.targetId];
                delete effectiveInventoryTotals[this.b5Planner.targetId];
            }

            const nonStorageAvailable = this.#mergeCounts(vaultTotals, effectiveInventoryTotals);
            const effectiveStorageItems = this.b1Materials
                ? this.b1Materials.effectiveItems(storageResult.data?.items || {})
                : { ...(storageResult.data?.items || {}) };
            const craftableStorageItems = this.b1Materials?.craftableItems
                ? this.b1Materials.craftableItems(storageResult.data || {})
                : effectiveStorageItems;
            // Keep both views: total stock answers whether the material is
            // owned at all; craftable stock answers whether it can execute with
            // the current /kho headroom. A blocked block-form reserve is an
            // actionable PREPARE_B1 state, not the same thing as missing stock.
            const allAvailable = this.#mergeCounts(nonStorageAvailable, craftableStorageItems);
            const planWithoutStorage = this.craftPlanningService.plan(amount, nonStorageAvailable);
            const fullPlan = this.craftPlanningService.plan(amount, allAvailable);
            const reservePartition = this.b5Planner.partition(planWithoutStorage);
            const fullPartition = this.b5Planner.partition(fullPlan);
            const chains = this.#buildB3Chains({
                planWithoutStorage,
                reserveSteps: reservePartition.reserveSteps,
                storageSnapshot: storageResult.data,
                effectiveStorageItems: craftableStorageItems,
                totalEffectiveStorageItems: effectiveStorageItems,
                vaultSnapshot: vaultResult.data,
                inventoryTotals: effectiveInventoryTotals
            });
            const progress = this.#buildProgress({
                amount,
                additional,
                fullPlan,
                finalSteps: fullPartition.finalSteps,
                chains,
                nonStorageAvailable,
                vaultTotals: vaultResult.data?.totals || {},
                inventoryTotals
            });

            const inspection = {
                amount,
                additional,
                storage: storageResult.data,
                effectiveStorageItems,
                craftableStorageItems,
                personalVault: vaultResult.data,
                personalVaultPressure,
                b1Supply: Object.freeze({ mode: String(this.config?.b1SupplyMode || 'finite').toLowerCase() }),
                inventory: inventorySnapshot,
                inventoryViews,
                inventoryTotals,
                inventoryTotalsBySource,
                nonStorageAvailable,
                allAvailable,
                planWithoutStorage,
                fullPlan,
                reserveSteps: reservePartition.reserveSteps,
                finalSteps: fullPartition.finalSteps,
                chains,
                progress,
                fresh
            };
            inspection.executionPlan = this.executionPlanner?.compile?.(inspection) || null;
            return Result.ok(inspection);
        } catch (error) {
            const wrapped = FlowError.wrap(error, {
                code: 'B5_PLANNING_FAILED', subsystem: 'b5-planning', operation: 'B5PlanningService',
                step: 'calculate-plan', action: additional ? 'inspect additional B5' : 'inspect B5 target',
                resource: this.b5Planner.targetId, details: { amount, additional }
            });
            return Result.fail(Operation.statusForError(wrapped), wrapped.message, wrapped, wrapped.toDiagnostic());
        }
    }

    #personalVaultPressure(snapshot) {
        const policy = this.config?.personalVaultBackpressure || {};
        const minEmptySlots = Math.max(0, Number(policy.minEmptySlots ?? 3));
        const hardMinEmptySlots = Math.max(0, Math.min(minEmptySlots, Number(policy.hardMinEmptySlots ?? 1)));
        const emptySlotCount = Number(snapshot?.emptySlotCount);
        const slotCount = Number(snapshot?.slotCount);
        const known = Number.isInteger(emptySlotCount) && emptySlotCount >= 0;
        return Object.freeze({
            known,
            emptySlotCount: known ? emptySlotCount : null,
            slotCount: Number.isInteger(slotCount) && slotCount >= 0 ? slotCount : null,
            minEmptySlots,
            hardMinEmptySlots,
            backpressure: known ? emptySlotCount <= minEmptySlots : false,
            critical: known ? emptySlotCount <= hardMinEmptySlots : false,
            allowNewIntermediates: known ? emptySlotCount > minEmptySlots : true
        });
    }

    #contextualize(result, context) {
        if (result?.success !== false) return result;
        const wrapped = FlowError.wrap(result.error || new Error(result.message || 'B5 planning dependency failed.'), {
            subsystem: 'b5-planning', operation: 'B5PlanningService', ...context,
            details: { ...(result.meta || {}), ...(context.details || {}) }
        });
        return Result.fail(result.status || Status.FAILED, wrapped.message, wrapped, wrapped.toDiagnostic());
    }

    #buildB3Chains({
        planWithoutStorage,
        reserveSteps,
        storageSnapshot,
        effectiveStorageItems,
        totalEffectiveStorageItems = effectiveStorageItems,
        vaultSnapshot,
        inventoryTotals
    }) {
        const stepsByOutput = new Map(reserveSteps.map(step => [step.outputId, step]));
        const chains = [];

        for (const b3Id of this.tiers?.B3 || []) {
            const b3RecipeEntry = this.#recipeForOutput(b3Id);
            if (!b3RecipeEntry) continue;
            const b2Ids = Object.keys(b3RecipeEntry.recipe.inputs || {});
            if (b2Ids.length !== 1) continue;
            const b2Id = b2Ids[0];
            const b2RecipeEntry = this.#recipeForOutput(b2Id);
            if (!b2RecipeEntry) continue;

            const baseRequirements = this.materialCalculator.requirements(b3Id, 1);
            const baseIds = Object.keys(baseRequirements);
            if (baseIds.length !== 1) continue;
            const baseId = baseIds[0];

            const rawNeededFromStorage = Number(planWithoutStorage.missing[baseId] || 0);
            const inventoryBase = this.config?.b2InputSource === 'inventory'
                ? Math.max(0, Number(inventoryTotals?.[baseId] || 0))
                : 0;
            const storageEffective = Number(effectiveStorageItems?.[baseId] || 0);
            const storageTotalEffective = Number(totalEffectiveStorageItems?.[baseId] || 0);
            const storedEffective = storageEffective + inventoryBase;
            const storedTotalEffective = storageTotalEffective + inventoryBase;
            // planWithoutStorage already consumed inventory B1. Only storage
            // may satisfy its remaining missing amount; subtracting inventory
            // again here would double-count leftovers from an earlier batch.
            const immediateMissingRaw = Math.max(0, rawNeededFromStorage - storageEffective);
            const missingRaw = Math.max(0, rawNeededFromStorage - storageTotalEffective);
            const readyToReserve = missingRaw === 0;
            const b2Step = stepsByOutput.get(b2Id) || null;
            const b3Step = stepsByOutput.get(b3Id) || null;

            chains.push(Object.freeze({
                baseId,
                b2Id,
                b3Id,
                b2RecipeId: b2RecipeEntry.recipeId,
                b3RecipeId: b3RecipeEntry.recipeId,
                b2OutputAmount: Number(b2RecipeEntry.recipe.outputAmount || 1),
                b3InputPerCraft: Number(b3RecipeEntry.recipe.inputs[b2Id] || 0),
                rawPerB3: Number(baseRequirements[baseId] || 0),
                rawNeededFromStorage,
                storedLoose: Number(storageSnapshot?.items?.[baseId] || 0),
                inventoryB1: inventoryBase,
                storageEffective,
                storageTotalEffective,
                storedEffective,
                storedTotalEffective,
                decompressionBlocked: storedTotalEffective > storedEffective,
                immediateMissingRaw,
                missingRaw,
                readyToReserve,
                b2Crafts: Number(b2Step?.crafts || 0),
                b3Crafts: Number(b3Step?.crafts || 0),
                vaultB2: Number(vaultSnapshot?.totals?.[b2Id] || 0),
                vaultB3: Number(vaultSnapshot?.totals?.[b3Id] || 0),
                inventoryB2: Number(inventoryTotals[b2Id] || 0),
                inventoryB3: Number(inventoryTotals[b3Id] || 0)
            }));
        }

        return Object.freeze(chains);
    }

    #buildProgress({ amount, additional, fullPlan, finalSteps, chains, nonStorageAvailable, vaultTotals, inventoryTotals }) {
        const targetId = fullPlan?.targetId || this.b5Planner.targetId;
        const targetRecipeEntry = this.#recipeForOutput(targetId);
        const targetInputs = { ...(targetRecipeEntry?.recipe?.inputs || {}) };
        const targetAmount = Math.max(1, Number(amount || 1));

        // Priority is intentionally top-down:
        // B5 -> any craftable B4 -> owned B2->B3 compaction -> new B2 from B1.
        // B3 "missing" is only planning information; it is never a reason to
        // postpone a B4 that can already be made.
        const b4 = Object.entries(targetInputs).map(([id, perTarget]) => {
            const required = Math.max(0, Number(perTarget || 0) * targetAmount);
            const available = Math.max(0, Number(nonStorageAvailable?.[id] || 0));
            const step = (finalSteps || []).find(candidate => candidate?.outputId === id) || null;
            const recipeEntry = this.#recipeForOutput(id);
            let craftableNow = 0;
            if (recipeEntry?.recipe) {
                const entries = Object.entries(recipeEntry.recipe.inputs || {}).filter(([, count]) => Number(count) > 0);
                if (entries.length > 0) {
                    craftableNow = Math.min(...entries.map(([inputId, count]) =>
                        Math.floor(Math.max(0, Number(nonStorageAvailable?.[inputId] || 0)) / Number(count))
                    ));
                }
            }
            return Object.freeze({
                id,
                required,
                available,
                missing: Math.max(0, required - available),
                plannedCrafts: Math.max(0, Number(step?.crafts || 0)),
                craftableNow: Math.max(0, Number.isFinite(craftableNow) ? craftableNow : 0)
            });
        });

        const b3 = (chains || []).map(chain => {
            const ownedB2 = Math.max(0, Number(chain.vaultB2 || 0) + Number(chain.inventoryB2 || 0));
            const inputPerCraft = Math.max(1, Number(chain.b3InputPerCraft || 1));
            return Object.freeze({
                id: chain.b3Id,
                b2Id: chain.b2Id,
                missingCrafts: Math.max(0, Number(chain.b3Crafts || 0)),
                available: Math.max(0, Number(chain.vaultB3 || 0) + Number(chain.inventoryB3 || 0)),
                b2Crafts: Math.max(0, Number(chain.b2Crafts || 0)),
                ownedB2,
                promotableFromOwnedB2: Math.max(0, Math.floor(ownedB2 / inputPerCraft)),
                waitingRaw: Math.max(0, Number(chain.missingRaw || 0))
            });
        });

        const b5DirectReady = b4.length > 0 && b4.every(entry => entry.available >= entry.required);
        const b4Craftable = b4.filter(entry => entry.craftableNow > 0);
        const b4CraftableMissingFirst = [
            ...b4Craftable.filter(entry => entry.missing > 0),
            ...b4Craftable.filter(entry => entry.missing <= 0)
        ];
        const b3Promotable = b3.filter(entry => entry.promotableFromOwnedB2 > 0);

        const reserveStages = (chains || []).reduce((count, chain) =>
            count + (Number(chain.b2Crafts || 0) > 0 ? 1 : 0) + (Number(chain.b3Crafts || 0) > 0 ? 1 : 0), 0);
        const finalStages = (finalSteps || []).filter(step => Number(step?.crafts || 0) > 0).length;
        const completionStages = finalStages > 0 || b5DirectReady ? 2 : 0; // deposit B5 + verify /pv 2
        const remainingStages = b5DirectReady ? 3 : reserveStages + finalStages + completionStages;
        const remainingCrafts = (chains || []).reduce((sum, chain) =>
            sum + Math.max(0, Number(chain.b2Crafts || 0)) + Math.max(0, Number(chain.b3Crafts || 0)), 0)
            + (finalSteps || []).reduce((sum, step) => sum + Math.max(0, Number(step?.crafts || 0)), 0);

        let nextStep = null;
        if (b5DirectReady) {
            nextStep = { kind: 'B5', id: targetId, crafts: targetAmount };
        } else if (b4CraftableMissingFirst.length > 0) {
            const entry = b4CraftableMissingFirst[0];
            nextStep = {
                kind: 'B4',
                id: entry.id,
                crafts: entry.missing > 0 ? Math.min(entry.missing, entry.craftableNow) : entry.craftableNow,
                reason: entry.missing > 0 ? 'b5-priority' : 'storage-compaction'
            };
        } else if (b3Promotable.length > 0) {
            const entry = b3Promotable[0];
            nextStep = {
                kind: 'B3',
                id: entry.id,
                crafts: entry.promotableFromOwnedB2,
                from: entry.b2Id,
                reason: 'compress-owned-b2'
            };
        } else {
            // Only after every currently-owned higher-tier opportunity has been
            // exhausted do we create more B2/B3 from B1.
            for (const chain of chains || []) {
                if (Number(chain.b3Crafts || 0) > 0 && Number(chain.b2Crafts || 0) <= 0) {
                    nextStep = { kind: 'B3', id: chain.b3Id, crafts: Number(chain.b3Crafts || 0) };
                    break;
                }
                if (Number(chain.b2Crafts || 0) > 0) {
                    const needsBasePreparation = Number(chain.immediateMissingRaw || 0) > 0
                        && Number(chain.missingRaw || 0) <= 0;
                    nextStep = needsBasePreparation
                        ? {
                            kind: 'PREPARE_B1',
                            id: chain.baseId,
                            b2Id: chain.b2Id,
                            b3Id: chain.b3Id,
                            b2Crafts: Number(chain.b2Crafts || 0),
                            reason: chain.decompressionBlocked ? 'decompression-headroom' : 'prepare-base-form'
                        }
                        : {
                            kind: 'B2/B3', id: chain.b3Id, b2Id: chain.b2Id,
                            b2Crafts: Number(chain.b2Crafts || 0), b3Crafts: Number(chain.b3Crafts || 0)
                        };
                    break;
                }
            }
            if (!nextStep) {
                const step = (finalSteps || []).find(candidate => Number(candidate?.crafts || 0) > 0);
                if (step) nextStep = {
                    kind: step.outputId === targetId ? 'B5' : 'B4',
                    id: step.outputId,
                    recipeId: step.recipeId,
                    crafts: Number(step.crafts || 0)
                };
            }
        }

        const missingBase = Object.fromEntries(Object.entries(fullPlan?.missing || {})
            .filter(([, count]) => Number(count || 0) > 0)
            .map(([id, count]) => [id, Number(count)]));
        const b3MissingTotal = b3.reduce((sum, entry) => sum + entry.missingCrafts, 0);
        const targetExisting = Math.max(0, Number(vaultTotals?.[targetId] || 0) + Number(inventoryTotals?.[targetId] || 0));
        let state = fullPlan?.feasible ? 'READY' : 'WAITING_MATERIALS';
        if (b5DirectReady) state = 'B5_READY';
        else if (b4CraftableMissingFirst.length > 0) state = 'B4_READY';
        else if (b3Promotable.length > 0) state = 'B3_COMPACTING';
        else if (fullPlan?.feasible && remainingStages === 0) state = 'READY_TO_VERIFY';

        return Object.freeze({
            targetId,
            amount: targetAmount,
            additional: Boolean(additional),
            feasible: Boolean(fullPlan?.feasible),
            state,
            priority: Object.freeze(['B5', 'B4', 'B3', 'B2']),
            b5DirectReady,
            b3: Object.freeze(b3),
            b3MissingTotal,
            b3PromotableTotal: b3Promotable.reduce((sum, entry) => sum + entry.promotableFromOwnedB2, 0),
            b4: Object.freeze(b4),
            b4CraftableTotal: b4Craftable.reduce((sum, entry) => sum + entry.craftableNow, 0),
            targetExisting,
            reserveStages,
            finalStages,
            remainingStages,
            remainingCrafts,
            nextStep: nextStep ? Object.freeze(nextStep) : null,
            missingBase: Object.freeze(missingBase)
        });
    }

    #knownIds() {
        // Storage-direct keeps B1 authoritative in /kho. Inventory-source B2
        // also counts leftover B1 so the next batch does not withdraw or
        // accumulate a duplicate amount.
        const ids = new Set();
        const tiers = this.config?.b2InputSource === 'inventory'
            ? ['B1', 'B2', 'B3', 'B4', 'B5']
            : ['B2', 'B3', 'B4', 'B5'];
        for (const tier of tiers) {
            for (const id of this.tiers?.[tier] || []) ids.add(id);
        }
        ids.add(this.b5Planner.targetId);
        return ids;
    }

    #recipeForOutput(outputId) {
        for (const recipeId of this.recipeRegistry.ids()) {
            const recipe = this.recipeRegistry.require(recipeId);
            if (recipe.output === outputId) return { recipeId, recipe };
        }
        return null;
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
}

module.exports = B5PlanningService;
