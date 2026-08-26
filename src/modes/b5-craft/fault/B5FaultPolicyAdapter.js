'use strict';

class B5FaultPolicyAdapter {
    constructor(policy) {
        if (!policy) throw new TypeError('B5FaultPolicyAdapter policy is required.');
        this.policy = policy;
    }

    reset(...args) { return this.policy.reset(...args); }
    close(...args) { return this.policy.close(...args); }
    beforeAttempt(...args) { return this.policy.beforeAttempt(...args); }
    record(...args) { return this.policy.record(...args); }
    recordBlocker(...args) { return this.policy.recordBlocker(...args); }
    resolveEpisode(...args) { return this.policy.resolveEpisode(...args); }
    restartPolicy(...args) { return this.policy.restartPolicy(...args); }
    snapshot(...args) { return this.policy.snapshot(...args); }
}

module.exports = B5FaultPolicyAdapter;
