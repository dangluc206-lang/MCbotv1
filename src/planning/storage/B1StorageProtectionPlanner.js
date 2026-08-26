'use strict';

const DecisionReplayEnvelope = require('../../shared/contracts/DecisionReplayEnvelope');

const VERSION = 1;
const DEFAULT_SELL_QUANTITY = 64;

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function freeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; for (const child of Object.values(value)) freeze(child); return Object.freeze(value); }

class B1StorageProtectionPlanner {
    constructor({ materialPolicy, sellQuantity = DEFAULT_SELL_QUANTITY } = {}) {
        if (!materialPolicy?.coverageSnapshot || !materialPolicy?.resources) throw new TypeError('B1StorageProtectionPlanner materialPolicy is required.');
        this.materialPolicy = materialPolicy;
        this.sellQuantity = Math.max(1, Number(sellQuantity) || DEFAULT_SELL_QUANTITY);
    }

    compile({ snapshot, reserveCoverage = 1.5, freshness = null, profile = null, policy = null } = {}) {
        const blockers = [];
        const normalizedReserveCoverage = Math.max(0, Number(reserveCoverage) || 0);
        if (!snapshot || typeof snapshot !== 'object' || !snapshot.items || typeof snapshot.items !== 'object') blockers.push({ code: 'SNAPSHOT_INCOMPLETE', reason: 'storage-items-missing' });
        if (freshness?.confirmed !== true) blockers.push({ code: 'SNAPSHOT_NOT_FRESH', reason: 'fresh-observation-required' });
        if (freshness?.expectedGeneration != null && freshness?.currentGeneration != null
            && Number(freshness.expectedGeneration) !== Number(freshness.currentGeneration)) blockers.push({ code: 'STALE_GENERATION', reason: 'generation-mismatch' });
        const safeSnapshot = clone(snapshot || { items: {} });
        const coverage = blockers.length ? {} : this.materialPolicy.coverageSnapshot(safeSnapshot);
        // A pre-existing shortage is not a planner failure. It contributes no
        // sell actions and remains a reserve-readiness condition for the same
        // immutable episode. This lets other families sell their fixed surplus
        // once, then wait for only the missing family without re-smelting,
        // re-compacting or re-baselining.
        const reserveShortages = blockers.length ? [] : Object.values(coverage || {})
            .filter(family => Math.max(0, Number(family?.coverage || 0)) + 1e-9 < normalizedReserveCoverage)
            .map(family => {
                const actualCoverage = Math.max(0, Number(family?.coverage || 0));
                const requiredPerB5 = Math.max(0, Number(family?.requiredPerB5 || 0));
                const requiredBase = requiredPerB5 * normalizedReserveCoverage;
                const effectiveB1 = Math.max(0, Number(family?.effectiveB1 || 0));
                return {
                    code: 'RESERVE_INPUT_PENDING',
                    reason: 'baseline-coverage-below-hard-reserve',
                    baseId: family?.baseId || null,
                    coverage: actualCoverage,
                    requiredCoverage: normalizedReserveCoverage,
                    effectiveB1,
                    requiredBase,
                    missingBaseUnits: Math.max(0, requiredBase - effectiveB1)
                };
            });
        const budget = blockers.length ? this.#emptyBudget() : this.#buildBudget(safeSnapshot, coverage, normalizedReserveCoverage);
        const decision = {
            kind: blockers.length ? 'BLOCKED' : (budget.actions.length ? 'SELL_SURPLUS_64' : 'NOOP'),
            sellQuantity: this.sellQuantity,
            reserveCoverage: normalizedReserveCoverage,
            actions: budget.actions,
            blockers
        };
        const replayEnvelope = profile?.id && profile?.revision && policy?.id && policy?.revision
            ? DecisionReplayEnvelope.create({ domain: 'storage-protection', input: { snapshot: safeSnapshot, freshness: clone(freshness), reserveCoverage: decision.reserveCoverage }, decision, profile, policy })
            : null;
        return freeze({ version: VERSION, snapshot: safeSnapshot, coverage: clone(coverage), reserveShortages, ...budget, decision, blockers, replayEnvelope });
    }

    #emptyBudget() { return { byMaterial: {}, actions: [], totalSafeSurplusItems: 0, totalSellItems: 0, retainedRemainderItems: {} }; }

    #buildBudget(snapshot, coverage, reserveCoverage) {
        const byMaterial = {}, actions = [], retainedRemainderItems = {};
        let totalSafeSurplusItems = 0, totalSellItems = 0;
        for (const resource of Object.values(this.materialPolicy.resources || {})) {
            const family = coverage?.[resource.baseId];
            if (!family) continue;
            // B5 protection may sell compressed block forms only. Base/raw
            // resources remain reserve inputs even when a legacy sellId exists.
            let sellId = null, baseUnitsPerItem = null;
            if (resource.blockId && resource.sellId === resource.blockId) { sellId = resource.blockId; baseUnitsPerItem = resource.ratio; }
            if (!sellId) continue;
            const stored = Math.max(0, Number(snapshot?.items?.[sellId] || 0));
            const reserveBase = Math.max(0, Number(family.requiredPerB5 || 0) * reserveCoverage);
            const safeBaseSurplus = Math.max(0, Number(family.effectiveB1 || 0) - reserveBase);
            const rawSafeItems = Math.min(stored, Math.floor((safeBaseSurplus + 1e-9) / baseUnitsPerItem));
            totalSafeSurplusItems += rawSafeItems;
            const safeItems = Math.floor(rawSafeItems / this.sellQuantity) * this.sellQuantity;
            const retainedItems = Math.max(0, rawSafeItems - safeItems);
            if (retainedItems > 0) retainedRemainderItems[sellId] = retainedItems;
            totalSellItems += safeItems;
            if (rawSafeItems <= 0) continue;
            const clicks = Math.floor(safeItems / this.sellQuantity);
            byMaterial[sellId] = { material: resource.baseId, sellId, items: safeItems, rawSafeItems, retainedRemainderItems: retainedItems, baseUnitsPerItem, reserveBase, clicks64: clicks, clickBudget: clicks };
            for (let index = 0; index < clicks; index += 1) actions.push({ baseId: resource.baseId, logicalId: sellId, quantity: this.sellQuantity, baseUnitsPerItem });
        }
        return { byMaterial, actions, totalSafeSurplusItems, totalSellItems, retainedRemainderItems };
    }
}

B1StorageProtectionPlanner.VERSION = VERSION;
module.exports = B1StorageProtectionPlanner;
