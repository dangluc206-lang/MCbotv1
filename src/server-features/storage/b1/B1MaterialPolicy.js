'use strict';

class B1MaterialPolicy {
    constructor({ minerals, conversionConfig, smeltingConfig, recipeConfig = null, targetId = 'super_alloy' }) {
        this.minerals = minerals;
        this.conversionConfig = conversionConfig;
        this.resources = this.#validateResources(conversionConfig?.resources);
        this.b1DemandWeights = this.#deriveB1DemandWeights(recipeConfig, targetId);
        this.rawInputsByBase = this.#deriveRawInputsByBase(smeltingConfig);
    }

    effectiveItems(items = {}) {
        const output = { ...(items || {}) };
        for (const resource of Object.values(this.resources)) {
            const loose = Number(items?.[resource.baseId] || 0);
            const canExpandBlocks = resource.blockId
                && this.minerals?.isAvailable?.(resource.baseId, 'toBase') !== false;
            const blocks = canExpandBlocks ? Number(items?.[resource.blockId] || 0) : 0;
            output[resource.baseId] = loose + (blocks * resource.ratio);
        }
        return output;
    }

    craftableItems(snapshot = {}) {
        const items = snapshot?.items || snapshot || {};
        const output = { ...(items || {}) };
        for (const resource of Object.values(this.resources)) {
            const loose = Number(items?.[resource.baseId] || 0);
            const canExpandBlocks = resource.blockId
                && this.minerals?.isAvailable?.(resource.baseId, 'toBase') !== false;
            if (!canExpandBlocks) {
                output[resource.baseId] = loose;
                continue;
            }
            const assessment = this.assessBlockExpansion(snapshot, resource);
            const blocks = assessment.safe ? Number(items?.[resource.blockId] || 0) : 0;
            output[resource.baseId] = loose + (blocks * resource.ratio);
        }
        return output;
    }

    coverageSnapshot(snapshot = {}) {
        const items = snapshot?.items || snapshot || {};
        const materials = {};
        for (const resource of Object.values(this.resources)) {
            const requiredPerB5 = Math.max(1, Number(this.b1DemandWeights?.[resource.baseId] || 1));
            const loose = Math.max(0, Number(items?.[resource.baseId] || 0));
            const blocks = resource.blockId ? Math.max(0, Number(items?.[resource.blockId] || 0)) : 0;
            let rawEffective = 0;
            const raw = [];
            for (const entry of this.rawInputsByBase?.[resource.baseId] || []) {
                const count = Math.max(0, Number(items?.[entry.inputId] || 0));
                const effective = count * entry.basePerInput;
                rawEffective += effective;
                raw.push(Object.freeze({ ...entry, count, effective }));
            }
            const effectiveB1 = loose + (blocks * resource.ratio) + rawEffective;
            materials[resource.baseId] = Object.freeze({
                baseId: resource.baseId,
                blockId: resource.blockId,
                loose,
                blocks,
                raw: Object.freeze(raw),
                rawEffective,
                effectiveB1,
                requiredPerB5,
                coverage: effectiveB1 / requiredPerB5
            });
        }
        return Object.freeze(materials);
    }


    selectReserveSaleAction(items, coverage, reserveCoverage, unavailable = new Set(), _materialTrend = {}, { minCoverageToSell = reserveCoverage } = {}) {
        const candidates = [];
        for (const resource of Object.values(this.resources)) {
            const family = coverage?.[resource.baseId];
            if (!family || !(family.coverage > minCoverageToSell)) continue;
            const reserveBase = family.requiredPerB5 * reserveCoverage;
            const add = (logicalId, count, baseUnitsPerItem) => {
                const stored = Math.max(0, Number(count || 0));
                if (!logicalId || stored <= 0 || unavailable.has(logicalId)) return;
                let quantity = null;
                if (stored >= 64 && family.effectiveB1 - (64 * baseUnitsPerItem) >= reserveBase) quantity = 64;
                if (!quantity) return;
                candidates.push({
                    baseId: resource.baseId,
                    logicalId,
                    quantity,
                    stored,
                    count: stored,
                    baseUnitsPerItem,
                    coverage: family.coverage,
                    coverageB5: family.coverage,
                    surplusCoverage: family.coverage - reserveCoverage,
                    effectiveBefore: family.effectiveB1,
                    effectiveAfter: family.effectiveB1 - (quantity * baseUnitsPerItem),
                    reserveBase
                });
            };
            if (resource.blockId && resource.sellId === resource.blockId) {
                add(resource.sellId, items?.[resource.sellId], resource.ratio);
            } else if (!resource.blockId && resource.sellId === resource.baseId && resource.ratio === 1) {
                add(resource.sellId, items?.[resource.sellId], 1);
            }
        }
        candidates.sort((a, b) =>
            b.surplusCoverage - a.surplusCoverage
            || b.stored - a.stored
            || a.logicalId.localeCompare(b.logicalId));
        return candidates[0] || null;
    }

    snapshotAfterSale(snapshot, selected) {
        const nextItems = { ...(snapshot?.items || {}) };
        const before = Math.max(0, Number(nextItems[selected.logicalId] || 0));
        const requested = Math.max(0, Number(selected.quantity || 0));
        nextItems[selected.logicalId] = Math.max(0, before - requested);
        return { ...(snapshot || {}), items: nextItems };
    }

    coverageLog(coverage) {
        return Object.values(coverage || {}).map(entry => ({
            baseId: entry.baseId,
            coverage: Number(entry.coverage.toFixed(3)),
            effectiveB1: entry.effectiveB1,
            requiredPerB5: entry.requiredPerB5,
            rawEffective: entry.rawEffective,
            loose: entry.loose,
            blocks: entry.blocks
        }));
    }

    assessBlockExpansion(snapshot, resource, { maxRatioOverride = null, requireKnownCapacityOverride = false, unbounded = false } = {}) {
        const items = snapshot?.items || snapshot || {};
        const blocks = Math.max(0, Number(items?.[resource.blockId] || 0));
        const expansionDelta = Math.max(0, blocks * Math.max(0, resource.ratio - 1));
        if (blocks <= 0 || expansionDelta <= 0) {
            return Object.freeze({ safe: true, reason: 'no-expansion', blocks, expansionDelta, projectedUsed: null, projectedRatio: null });
        }
        if (unbounded === true) {
            return Object.freeze({ safe: true, reason: 'unbounded-by-mode', blocks, expansionDelta, projectedUsed: null, projectedRatio: null, maxRatio: null });
        }

        const capacity = snapshot?.capacity || null;
        const used = Number(capacity?.used);
        const limit = Number(capacity?.limit ?? capacity?.total);
        const requireKnownCapacity = requireKnownCapacityOverride === true;
        const configuredMax = Number(maxRatioOverride);
        const maxRatio = Number.isFinite(configuredMax) && configuredMax > 0 && configuredMax <= 1 ? configuredMax : 0.85;

        if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
            return Object.freeze({
                safe: !requireKnownCapacity,
                reason: requireKnownCapacity ? 'capacity-unknown' : 'capacity-unknown-allowed',
                blocks,
                expansionDelta,
                used: Number.isFinite(used) ? used : null,
                limit: Number.isFinite(limit) ? limit : null,
                projectedUsed: null,
                projectedRatio: null,
                maxRatio
            });
        }

        const projectedUsed = used + expansionDelta;
        const projectedRatio = projectedUsed / limit;
        return Object.freeze({
            safe: projectedRatio <= maxRatio,
            reason: projectedRatio <= maxRatio ? 'within-headroom' : 'unsafe-block-expansion',
            blocks,
            expansionDelta,
            used,
            limit,
            projectedUsed,
            projectedRatio,
            maxRatio
        });
    }

    #deriveRawInputsByBase(smeltingConfig) {
        const output = {};
        for (const [recipeId, recipe] of Object.entries(smeltingConfig?.recipes || {})) {
            const baseId = recipe?.output;
            if (!this.resources?.[baseId] || !recipe?.input) continue;
            const inputAmount = Math.max(1, Number(recipe.inputAmount || 1));
            const outputAmount = Math.max(0, Number(recipe.outputAmount || 1));
            const basePerInput = outputAmount / inputAmount;
            if (!(basePerInput > 0)) continue;
            if (!output[baseId]) output[baseId] = [];
            output[baseId].push(Object.freeze({ recipeId, inputId: recipe.input, basePerInput }));
        }
        for (const key of Object.keys(output)) output[key] = Object.freeze(output[key]);
        return Object.freeze(output);
    }

    #deriveB1DemandWeights(recipeConfig, targetId) {
        const recipes = recipeConfig && typeof recipeConfig === 'object' ? recipeConfig : null;
        if (!recipes || !recipes[targetId]) return Object.freeze({});
        const visiting = new Set();
        const expand = (itemId, amount) => {
            if (!recipes[itemId]) return { [itemId]: amount };
            if (visiting.has(itemId)) throw new Error(`Crafting recipe cycle detected while deriving B1 demand: ${itemId}`);
            visiting.add(itemId);
            const recipe = recipes[itemId];
            const outputAmount = Math.max(1, Number(recipe.outputAmount || 1));
            const multiplier = amount / outputAmount;
            const totals = {};
            for (const [inputId, inputAmount] of Object.entries(recipe.inputs || {})) {
                const expanded = expand(inputId, Number(inputAmount) * multiplier);
                for (const [leafId, leafAmount] of Object.entries(expanded)) {
                    totals[leafId] = Number(totals[leafId] || 0) + Number(leafAmount || 0);
                }
            }
            visiting.delete(itemId);
            return totals;
        };
        const leaves = expand(targetId, 1);
        const weights = {};
        for (const baseId of Object.keys(this.resources)) {
            const amount = Number(leaves[baseId] || 0);
            if (amount > 0) weights[baseId] = amount;
        }
        return Object.freeze(weights);
    }

    #validateResources(resources) {
        if (!resources || typeof resources !== 'object') throw new Error('mineralConversions.resources is required');
        const normalized = {};
        for (const [baseId, resource] of Object.entries(resources)) {
            const ratio = Number(resource?.ratio);
            if (resource?.baseId !== baseId) throw new Error(`Invalid baseId for mineral conversion: ${baseId}`);
            if (!Number.isSafeInteger(ratio) || ratio < 1) throw new Error(`Invalid block ratio for ${baseId}`);
            const blockId = resource.blockId || null;
            const sellId = resource.sellId || blockId || baseId;
            if (blockId && sellId !== blockId) {
                throw new Error(`Unsafe sellId for ${baseId}: compressed resources may only sell blockId.`);
            }
            if (!blockId && (sellId !== baseId || ratio !== 1)) {
                throw new Error(`Unsafe sellId for ${baseId}: a resource without blockId must use a 1:1 base sell form.`);
            }
            normalized[baseId] = Object.freeze({ ...resource, baseId, blockId, sellId, ratio });
        }
        return Object.freeze(normalized);
    }

}

module.exports = B1MaterialPolicy;
