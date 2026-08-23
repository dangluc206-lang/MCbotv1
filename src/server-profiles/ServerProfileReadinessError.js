'use strict';

const FlowError = require('../shared/errors/FlowError');

class ServerProfileReadinessError extends FlowError {
    constructor(message, { profileId = null, profileRevision = null, missing = null, details = null } = {}) {
        super(message || 'Server profile is not ready.', {
            code: 'SERVER_PROFILE_NOT_READY',
            subsystem: 'server-profile',
            operation: 'ServerProfile',
            retryable: false,
            details: { profileId, profileRevision, missing, ...(details || {}) }
        });
        this.name = 'ServerProfileReadinessError';
    }
}

module.exports = ServerProfileReadinessError;
