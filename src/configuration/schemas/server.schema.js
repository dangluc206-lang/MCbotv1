'use strict';

function rejectUnknown(value, allowed, label, errors) {
    const keys = new Set(allowed);
    for (const key of Object.keys(value || {})) {
        if (!keys.has(key)) errors.push(`${label}.${key} is not allowed`);
    }
}

function validateEndpoint(value, label, errors) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${label} must be an object`);
        return;
    }
    rejectUnknown(value, ['host', 'port', 'auth', 'version'], label, errors);
    if (typeof value.host !== 'string' || !value.host.trim()) {
        errors.push(`${label}.host is required`);
    }
    if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) {
        errors.push(`${label}.port must be 1..65535`);
    }
    if (value.auth !== undefined && (typeof value.auth !== 'string' || !value.auth.trim())) errors.push(`${label}.auth must be a non-empty string`);
    if (value.version !== undefined && value.version !== false && typeof value.version !== 'string') errors.push(`${label}.version must be false or a string`);
}

module.exports = value => {
    const errors = [];

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { valid: false, errors: ['server config must be an object'] };
    }

    if (value.profiles !== undefined) {
        rejectUnknown(value, ['defaultProfile', 'defaults', 'profiles'], 'server', errors);
        if (!value.defaults || typeof value.defaults !== 'object' || Array.isArray(value.defaults)) {
            errors.push('defaults must be an object');
        } else {
            rejectUnknown(value.defaults, ['auth', 'version'], 'defaults', errors);
            if (value.defaults.auth !== undefined && (typeof value.defaults.auth !== 'string' || !value.defaults.auth.trim())) errors.push('defaults.auth must be a non-empty string');
            if (value.defaults.version !== undefined && value.defaults.version !== false && typeof value.defaults.version !== 'string') errors.push('defaults.version must be false or a string');
        }
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
        rejectUnknown(value, ['host', 'port', 'auth', 'version'], 'server', errors);
        validateEndpoint(value, 'server', errors);
    }

    return { valid: errors.length === 0, errors };
};
