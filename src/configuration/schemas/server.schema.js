'use strict';

function validateEndpoint(value, label, errors) {
    if (!value || typeof value !== 'object') {
        errors.push(`${label} must be an object`);
        return;
    }
    if (typeof value.host !== 'string' || !value.host.trim()) {
        errors.push(`${label}.host is required`);
    }
    if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) {
        errors.push(`${label}.port must be 1..65535`);
    }
}

module.exports = value => {
    const errors = [];

    if (!value || typeof value !== 'object') {
        return { valid: false, errors: ['server config must be an object'] };
    }

    if (value.profiles !== undefined) {
        if (!value.profiles || typeof value.profiles !== 'object' || Array.isArray(value.profiles)) {
            errors.push('profiles must be an object');
        } else {
            const entries = Object.entries(value.profiles);
            if (entries.length === 0) errors.push('profiles must not be empty');
            for (const [name, endpoint] of entries) {
                validateEndpoint(endpoint, `profiles.${name}`, errors);
            }
        }
        if (value.defaultProfile !== undefined && typeof value.defaultProfile !== 'string') {
            errors.push('defaultProfile must be a string');
        }
        if (value.defaultProfile && !value.profiles?.[value.defaultProfile]) {
            errors.push(`defaultProfile does not exist: ${value.defaultProfile}`);
        }
    } else {
        validateEndpoint(value, 'server', errors);
    }

    return { valid: errors.length === 0, errors };
};
