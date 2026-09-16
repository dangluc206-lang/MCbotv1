'use strict';

class B5Planner {
    constructor({ planner, targetId = 'super_alloy', tiers = {} }) {
        this.planner = planner;
        this.targetId = targetId;
        this.tiers = tiers;
        this.tierByItem = new Map();
        for (const [tier, ids] of Object.entries(tiers || {})) {
            for (const id of ids || []) this.tierByItem.set(id, tier);
        }
    }

    /**
     * CraftPlanningService always calls plan(targetId, amount, available); a
     * per-request targetId therefore overrides this.targetId (which stays the
     * legacy/config default so existing callers keep their exact behavior).
     */
    plan(targetId, amount = 1, available = {}) {
        const resolvedTarget = String(targetId || this.targetId || '').trim() || this.targetId;
        return this.planner.plan(resolvedTarget, amount, available);
    }

    partition(plan) {
        const reserveSteps = [];
        const finalSteps = [];
        for (const step of plan.steps) {
            const tier = this.tierByItem.get(step.outputId) || null;
            if (tier === 'B2' || tier === 'B3') reserveSteps.push(step);
            else finalSteps.push(step);
        }
        return Object.freeze({
            reserveSteps: Object.freeze(reserveSteps),
            finalSteps: Object.freeze(finalSteps)
        });
    }
}

module.exports = B5Planner;
