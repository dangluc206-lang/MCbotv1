'use strict';

const BOT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/;

function rejectUnknown(value, allowed, label, errors) {
    const keys = new Set(allowed);
    for (const key of Object.keys(value || {})) {
        if (!keys.has(key)) errors.push(`${label}.${key} is not allowed`);
    }
}

module.exports = value => {
    const errors = [];

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { valid: false, errors: ['bot profile must be an object'] };
    }
    rejectUnknown(value, [
        'id', 'enabled', 'displayName', 'username', 'auth', 'version',
        'serverProfile', 'skyblockSelection', 'role', 'readyTimeoutMs', 'reconnect', 'fishing'
    ], 'bot', errors);

    if (typeof value.id !== 'string' || !BOT_ID_PATTERN.test(value.id)) {
        errors.push('id must match ^[a-z0-9][a-z0-9_-]{1,31}$');
    }
    if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
        errors.push('enabled must be boolean');
    }
    if (value.displayName !== undefined && (typeof value.displayName !== 'string' || !value.displayName.trim())) {
        errors.push('displayName must be a non-empty string');
    }
    if (value.enabled && (typeof value.username !== 'string' || !value.username.trim())) {
        errors.push('username is required for enabled bot');
    }
    if (value.auth !== undefined && (typeof value.auth !== 'string' || !value.auth.trim())) {
        errors.push('auth must be a non-empty string');
    }
    if (value.version !== undefined && value.version !== false && typeof value.version !== 'string') {
        errors.push('version must be false or a version string');
    }
    if (value.serverProfile !== undefined && (typeof value.serverProfile !== 'string' || !value.serverProfile.trim())) {
        errors.push('serverProfile must be a non-empty string');
    }
    if (value.skyblockSelection !== undefined && (typeof value.skyblockSelection !== 'string' || !value.skyblockSelection.trim())) {
        errors.push('skyblockSelection must be a non-empty string');
    }
    if (value.role !== undefined && (typeof value.role !== 'string' || !value.role.trim())) {
        errors.push('role must be a non-empty string');
    }
    if (value.readyTimeoutMs !== undefined && (!Number.isFinite(value.readyTimeoutMs) || value.readyTimeoutMs <= 0)) {
        errors.push('readyTimeoutMs must be positive');
    }

    if (value.reconnect !== undefined) {
        if (!value.reconnect || typeof value.reconnect !== 'object' || Array.isArray(value.reconnect)) {
            errors.push('reconnect must be an object');
        } else {
            rejectUnknown(value.reconnect, ['enabled', 'maxAttempts', 'baseDelayMs', 'maxDelayMs'], 'reconnect', errors);
            if (value.reconnect.enabled !== undefined && typeof value.reconnect.enabled !== 'boolean') {
                errors.push('reconnect.enabled must be boolean');
            }
            for (const key of ['maxAttempts', 'baseDelayMs', 'maxDelayMs']) {
                const entry = value.reconnect[key];
                if (entry !== undefined && (!Number.isFinite(entry) || entry < 0)) {
                    errors.push(`reconnect.${key} must be a non-negative number`);
                }
            }
            if (
                Number.isFinite(value.reconnect.baseDelayMs)
                && Number.isFinite(value.reconnect.maxDelayMs)
                && value.reconnect.maxDelayMs < value.reconnect.baseDelayMs
            ) {
                errors.push('reconnect.maxDelayMs must be greater than or equal to baseDelayMs');
            }
        }
    }


    if (value.fishing !== undefined) {
        if (!value.fishing || typeof value.fishing !== 'object' || Array.isArray(value.fishing)) {
            errors.push('fishing must be an object');
        } else {
            const allowedFishingKeys = new Set(['shoreFishingPitchDegrees', 'areas']);
            for (const key of Object.keys(value.fishing)) {
                if (!allowedFishingKeys.has(key)) errors.push(`fishing.${key} is not an allowed bot override`);
            }
            if (value.fishing.shoreFishingPitchDegrees !== undefined) {
                const pitch = Number(value.fishing.shoreFishingPitchDegrees);
                if (!Number.isFinite(pitch) || pitch < 0 || pitch > 89) {
                    errors.push('fishing.shoreFishingPitchDegrees must be between 0 and 89');
                }
            }
            if (value.fishing.areas !== undefined) {
                if (!value.fishing.areas || typeof value.fishing.areas !== 'object' || Array.isArray(value.fishing.areas)) {
                    errors.push('fishing.areas must be an object');
                } else {
                    for (const [areaId, position] of Object.entries(value.fishing.areas)) {
                        if (!position || typeof position !== 'object' || Array.isArray(position)) {
                            errors.push(`fishing.areas.${areaId} must be an object`);
                            continue;
                        }
                        const allowedAreaKeys = new Set(['x', 'y', 'z']);
                        for (const key of Object.keys(position)) {
                            if (!allowedAreaKeys.has(key)) errors.push(`fishing.areas.${areaId}.${key} is not an allowed override`);
                        }
                        for (const axis of ['x', 'y', 'z']) {
                            if (position[axis] === null || position[axis] === undefined || typeof position[axis] === 'boolean' || !Number.isFinite(Number(position[axis]))) {
                                errors.push(`fishing.areas.${areaId}.${axis} must be a number`);
                            }
                        }
                    }
                }
            }
        }
    }

    return { valid: errors.length === 0, errors };
};
