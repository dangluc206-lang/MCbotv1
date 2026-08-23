'use strict';

const TOP_KEYS = new Set([
    'enabled','commandKey','guiTimeoutMs','openSettleMs','teleportTimeoutMs','teleportMinDistance',
    'areaRetryMs','errorRetryMs','connectionPollMs','rodMaterial','lookPitchDegrees','recastDelayMs',
    'biteTimeoutMs','positionGuardPollMs','occupancyPatterns','currentPatterns','areas','movement',
    'worldReadiness','positionGuard','probe','packetObservation','recovery'
]);

function finiteNumber(value) { return typeof value === 'number' && Number.isFinite(value); }
function positive(value) { return finiteNumber(value) && value > 0; }
function nonNegative(value) { return finiteNumber(value) && value >= 0; }
function object(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }

module.exports = value => {
    const errors = [];
    if (!object(value)) return { valid: false, errors: ['fishing config must be an object'] };
    for (const key of Object.keys(value)) if (!TOP_KEYS.has(key)) errors.push(`unknown fishing key: ${key}`);
    if (typeof value.enabled !== 'boolean') errors.push('enabled must be boolean');
    if (typeof value.commandKey !== 'string' || !value.commandKey.trim()) errors.push('commandKey is required');
    for (const key of ['guiTimeoutMs','teleportTimeoutMs','areaRetryMs','errorRetryMs','connectionPollMs','biteTimeoutMs','positionGuardPollMs']) {
        if (!positive(value[key])) errors.push(`${key} must be positive`);
    }
    if (!nonNegative(value.openSettleMs)) errors.push('openSettleMs must be non-negative');
    if (!positive(value.teleportMinDistance)) errors.push('teleportMinDistance must be positive');
    if (!nonNegative(value.recastDelayMs)) errors.push('recastDelayMs must be non-negative');
    if (typeof value.rodMaterial !== 'string' || !value.rodMaterial.trim()) errors.push('rodMaterial is required');
    if (!finiteNumber(value.lookPitchDegrees) || value.lookPitchDegrees < 0 || value.lookPitchDegrees > 89) errors.push('lookPitchDegrees must be between 0 and 89');
    for (const key of ['occupancyPatterns','currentPatterns']) {
        if (!Array.isArray(value[key]) || value[key].some(entry => typeof entry !== 'string' || !entry)) errors.push(`${key} must be an array of regex strings`);
        else for (const [index, pattern] of value[key].entries()) {
            try { new RegExp(pattern, 'i'); } catch (error) { errors.push(`${key}[${index}] is invalid: ${error.message}`); }
        }
    }

    const movement = value.movement;
    const movementKeys = new Set(['timeoutMs','tickMs','arrivalRadius','verticalTolerance','arrivalStableMs','noProgressMs','progressDelta','lookIntervalMs','shoreFishingPitchDegrees','localRetryLimit','localRetryDelayMs']);
    if (!object(movement)) errors.push('movement must be an object');
    else {
        for (const key of Object.keys(movement)) if (!movementKeys.has(key)) errors.push(`unknown movement key: ${key}`);
        for (const key of ['timeoutMs','tickMs','arrivalRadius','verticalTolerance','noProgressMs','progressDelta','lookIntervalMs']) if (!positive(movement[key])) errors.push(`movement.${key} must be positive`);
        if (!nonNegative(movement.arrivalStableMs)) errors.push('movement.arrivalStableMs must be non-negative');
        if (!Number.isInteger(movement.localRetryLimit) || movement.localRetryLimit < 0) errors.push('movement.localRetryLimit must be a non-negative integer');
        if (!nonNegative(movement.localRetryDelayMs)) errors.push('movement.localRetryDelayMs must be non-negative');
        if (!finiteNumber(movement.shoreFishingPitchDegrees) || movement.shoreFishingPitchDegrees < 0 || movement.shoreFishingPitchDegrees > 89) errors.push('movement.shoreFishingPitchDegrees must be between 0 and 89');
    }

    const world = value.worldReadiness;
    if (!object(world)) errors.push('worldReadiness must be an object');
    else {
        const allowed = new Set(['timeoutMs','pollMs','settleMs']);
        for (const key of Object.keys(world)) if (!allowed.has(key)) errors.push(`unknown worldReadiness key: ${key}`);
        if (!positive(world.timeoutMs)) errors.push('worldReadiness.timeoutMs must be positive');
        if (!positive(world.pollMs)) errors.push('worldReadiness.pollMs must be positive');
        if (!nonNegative(world.settleMs)) errors.push('worldReadiness.settleMs must be non-negative');
    }

    const guard = value.positionGuard;
    if (!object(guard)) errors.push('positionGuard must be an object');
    else {
        const allowed = new Set(['radius','verticalTolerance']);
        for (const key of Object.keys(guard)) if (!allowed.has(key)) errors.push(`unknown positionGuard key: ${key}`);
        if (!positive(guard.radius)) errors.push('positionGuard.radius must be positive');
        if (!positive(guard.verticalTolerance)) errors.push('positionGuard.verticalTolerance must be positive');
    }

    const packet = value.packetObservation;
    if (!object(packet)) errors.push('packetObservation must be an object');
    else {
        if (Object.keys(packet).some(key => key !== 'sampleLimit')) errors.push('packetObservation contains unknown keys');
        if (!Number.isInteger(packet.sampleLimit) || packet.sampleLimit < 1) errors.push('packetObservation.sampleLimit must be a positive integer');
    }

    const recovery = value.recovery;
    if (!object(recovery)) errors.push('recovery must be an object');
    else {
        const allowed = new Set(['waitMs','retryMs','movementRetryMs','connectionRetryMs','cycleRetryLimit']);
        for (const key of Object.keys(recovery)) if (!allowed.has(key)) errors.push(`unknown recovery key: ${key}`);
        for (const key of ['waitMs','retryMs','movementRetryMs','connectionRetryMs']) if (!nonNegative(recovery[key])) errors.push(`recovery.${key} must be non-negative`);
        if (!Number.isInteger(recovery.cycleRetryLimit) || recovery.cycleRetryLimit < 1) errors.push('recovery.cycleRetryLimit must be a positive integer');
    }

    const probe = value.probe;
    if (!object(probe)) errors.push('probe must be an object');
    else {
        const allowed = new Set(['enabled','maxProfiles','totalTimeoutMs','profileTimeoutMs','gapMs','profiles']);
        for (const key of Object.keys(probe)) if (!allowed.has(key)) errors.push(`unknown probe key: ${key}`);
        if (typeof probe.enabled !== 'boolean') errors.push('probe.enabled must be boolean');
        if (!Number.isInteger(probe.maxProfiles) || probe.maxProfiles < 1) errors.push('probe.maxProfiles must be a positive integer');
        if (!positive(probe.totalTimeoutMs)) errors.push('probe.totalTimeoutMs must be positive');
        if (!positive(probe.profileTimeoutMs)) errors.push('probe.profileTimeoutMs must be positive');
        if (!nonNegative(probe.gapMs)) errors.push('probe.gapMs must be non-negative');
        if (!Array.isArray(probe.profiles) || probe.profiles.length < 1) errors.push('probe.profiles must be a non-empty array');
        else for (const [index, profile] of probe.profiles.entries()) {
            if (!object(profile)) { errors.push(`probe.profiles[${index}] must be an object`); continue; }
            const profileKeys = new Set(['name','forward','sneak','sprint','jump']);
            for (const key of Object.keys(profile)) if (!profileKeys.has(key)) errors.push(`probe.profiles[${index}] unknown key: ${key}`);
            if (typeof profile.name !== 'string' || !profile.name.trim()) errors.push(`probe.profiles[${index}].name is required`);
            for (const key of ['forward','sneak','sprint','jump']) if (typeof profile[key] !== 'boolean') errors.push(`probe.profiles[${index}].${key} must be boolean`);
        }
    }

    if (!Array.isArray(value.areas) || value.areas.length < 1) errors.push('areas must be a non-empty array');
    else {
        const ids = new Set();
        const priorities = new Set();
        for (const [index, area] of value.areas.entries()) {
            if (!object(area)) { errors.push(`areas[${index}] must be an object`); continue; }
            const allowed = new Set(['id','menuSlot','priority','capacity','destination']);
            for (const key of Object.keys(area)) if (!allowed.has(key)) errors.push(`areas[${index}] unknown key: ${key}`);
            if (typeof area.id !== 'string' || !area.id.trim()) errors.push(`areas[${index}].id is required`);
            else if (ids.has(area.id)) errors.push(`duplicate area id: ${area.id}`); else ids.add(area.id);
            if (!Number.isInteger(area.menuSlot) || area.menuSlot < 0) errors.push(`areas[${index}].menuSlot must be a non-negative integer`);
            if (!Number.isInteger(area.priority) || area.priority < 1) errors.push(`areas[${index}].priority must be a positive integer`);
            else if (priorities.has(area.priority)) errors.push(`duplicate area priority: ${area.priority}`); else priorities.add(area.priority);
            if (area.capacity !== null && (!Number.isInteger(area.capacity) || area.capacity < 0)) errors.push(`areas[${index}].capacity must be null or a non-negative integer`);
            if (!object(area.destination)) errors.push(`areas[${index}].destination must be an object`);
            else {
                for (const key of Object.keys(area.destination)) if (!['x','y','z'].includes(key)) errors.push(`areas[${index}].destination unknown key: ${key}`);
                for (const axis of ['x','y','z']) if (!finiteNumber(area.destination[axis])) errors.push(`areas[${index}].destination.${axis} must be a finite number`);
            }
        }
    }

    return { valid: errors.length === 0, errors };
};
