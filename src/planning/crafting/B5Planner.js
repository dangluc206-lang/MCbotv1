'use strict';

class B5Planner {
    // No hard-coded target: the default target is configuration data injected
    // by the bootstrap layer. A missing targetId fails closed instead of
    // silently picking any item (e.g. super_alloy) for the operator.
    constructor({ planner, targetId, tiers = {} }) {
        if (!planner || typeof planner.plan !== 'function') throw new TypeError('B5Planner planner.plan is required.');
        const configured = String(targetId || '').trim();
        if (!configured) throw new TypeError('B5Planner targetId is required: it must come from configuration, never a code default.');
        this.planner = planner;
        this.targetId = configured;
        this.tiers = tiers;
        this.tierByItem = new Map();
        for (const [tier, ids] of Object.entries(tiers || {})) {
            for (const id of ids || []) this.tierByItem.set(id, tier);
        }
    }

    /**
     * CraftPlanningService always calls plan(targetId, amount, available); a
     * per-request targetId overrides this.targetId (the config-injected B5
     * consumer default so existing callers keep their exact behavior).
     */
    plan(targetId, amount = 1, available = {}) {
        const resolvedTarget = String(targetId || this.targetId || '').trim();
        if (!resolvedTarget) throw new TypeError('B5Planner targetId is required.');
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
