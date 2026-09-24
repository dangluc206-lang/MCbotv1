'use strict';

const CraftStageClassifier = require('./CraftStageClassifier');

class B5Planner {
    // No hard-coded target: the default target is configuration data injected
    // by the bootstrap layer. A missing targetId fails closed instead of
    // silently picking any item for the operator.
    constructor({ planner, targetId, tiers = {}, stageClassifier = null, reserveTiers = ['B2', 'B3'] }) {
        if (!planner || typeof planner.plan !== 'function') throw new TypeError('B5Planner planner.plan is required.');
        const configured = String(targetId || '').trim();
        if (!configured) throw new TypeError('B5Planner targetId is required: it must come from configuration, never a code default.');
        this.planner = planner;
        this.targetId = configured;
        this.tiers = tiers;
        // Stage classification belongs to the generic tier-driven classifier;
        // which tiers are "reserve" is B5 boundary policy, not planner logic.
        this.stageClassifier = stageClassifier || new CraftStageClassifier({ tiers, reserveTiers });
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
        return this.stageClassifier.partition(plan);
    }
}

module.exports = B5Planner;
