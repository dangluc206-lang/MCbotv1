'use strict';

class CraftPlanningService {
    constructor({ planner, config = {} } = {}) {
        if (!planner?.plan) {
            throw new TypeError('CraftPlanningService planner.plan is required.');
        }

        this.planner = planner;
        this.config = Object.freeze({
            defaultTargetId: config.defaultTargetId || null
        });
    }

    reconfigure(config = {}) {
        const next = config || {};

        this.config = Object.freeze({
            ...this.config,
            ...(Object.prototype.hasOwnProperty.call(next, 'defaultTargetId')
                ? { defaultTargetId: next.defaultTargetId || null }
                : {})
        });

        return this;
    }

    plan(targetId, amount, available = {}) {
        const resolvedTarget = String(targetId || this.config.defaultTargetId || '').trim();

        if (!resolvedTarget) {
            throw new TypeError('CraftPlanningService targetId is required.');
        }

        return this.planner.plan(resolvedTarget, amount, available);
    }

    planConfigured(amount, available = {}) {
        return this.plan(this.config.defaultTargetId, amount, available);
    }
}

module.exports = CraftPlanningService;