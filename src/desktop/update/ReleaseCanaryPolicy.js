'use strict';

const STAGES = Object.freeze([5, 25, 100]);

class ReleaseCanaryPolicy {
    constructor({ maxCriticalIncidents = 0, maxFailureRate = 0.02, minObservationMs = 15 * 60 * 1000 } = {}) {
        Object.assign(this, { maxCriticalIncidents, maxFailureRate, minObservationMs });
    }

    decide({ stagePercent, observedMs, attempts, failures, criticalIncidents, integrityValid, rollbackReady } = {}) {
        const currentIndex = STAGES.indexOf(Number(stagePercent));
        if (currentIndex < 0) return this.#decision('BLOCK', 'CANARY_STAGE_INVALID', stagePercent);
        if (integrityValid !== true || rollbackReady !== true) return this.#decision('BLOCK', 'RELEASE_SAFETY_PREREQUISITE', stagePercent);
        const rate = Number(attempts) > 0 ? Number(failures || 0) / Number(attempts) : 0;
        if (Number(criticalIncidents || 0) > this.maxCriticalIncidents || rate > this.maxFailureRate) return this.#decision('ROLLBACK', 'CANARY_HEALTH_REGRESSION', stagePercent, { failureRate:rate });
        if (Number(observedMs || 0) < this.minObservationMs) return this.#decision('HOLD', 'CANARY_OBSERVATION_INCOMPLETE', stagePercent, { remainingMs:this.minObservationMs - Number(observedMs || 0) });
        if (currentIndex === STAGES.length - 1) return this.#decision('COMPLETE', 'CANARY_FULLY_ROLLED_OUT', stagePercent, { failureRate:rate });
        return this.#decision('ADVANCE', 'CANARY_HEALTHY', STAGES[currentIndex + 1], { previousPercent:stagePercent, failureRate:rate });
    }

    #decision(action, reason, targetPercent, details = {}) {
        return Object.freeze({ contract:'release-canary-decision-v1', action, reason, targetPercent:Number(targetPercent), details:Object.freeze(details) });
    }
}

ReleaseCanaryPolicy.STAGES = STAGES;
module.exports = ReleaseCanaryPolicy;
