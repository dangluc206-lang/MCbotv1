'use strict';

class RuntimeRecoveryCoordinator {
    candidates(sources) { return Array.isArray(sources) ? [...sources] : []; }
    requireVerified(source) {
        if (!source) throw Object.assign(new Error('No verified recovery source is available.'), { code:'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED' });
        return source;
    }
}

module.exports = RuntimeRecoveryCoordinator;
