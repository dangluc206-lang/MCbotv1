'use strict';

/**
 * Generic craft planning entry point: plan(targetId, amount, available).
 * The target is always explicit per request. This service holds no default or
 * ambient target, so no generic path can silently plan one particular item.
 * Which items may be requested is target policy data (crafting-targets.json),
 * never a constant in planning code.
 */
class CraftPlanningService {
    constructor({ planner } = {}) {
        if (!planner?.plan) {
            throw new TypeError('CraftPlanningService planner.plan is required.');
        }

        this.planner = planner;
    }

    plan(targetId, amount, available = {}) {
        const resolvedTarget = String(targetId ?? '').trim();

        if (!resolvedTarget) {
            throw new TypeError('CraftPlanningService targetId is required.');
        }

        return this.planner.plan(resolvedTarget, amount, available);
    }
}

module.exports = CraftPlanningService;
