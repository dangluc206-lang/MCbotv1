'use strict';

const fishingSchema = require('../../configuration/schemas/fishing.schema');

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function finite(value) {
    if (value === null || value === undefined || typeof value === 'boolean' || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function resolveFishingConfig(sharedConfig = {}, botFishing = {}) {
    const base = clone(sharedConfig) || {};
    const overrides = botFishing && typeof botFishing === 'object' && !Array.isArray(botFishing)
        ? botFishing
        : {};
    const areaOverrides = overrides.areas && typeof overrides.areas === 'object' && !Array.isArray(overrides.areas)
        ? overrides.areas
        : {};

    const areas = Array.isArray(base.areas) ? base.areas.map(area => {
        const override = areaOverrides[area.id];
        const destinationOverride = override && typeof override === 'object' && !Array.isArray(override)
            ? (override.destination && typeof override.destination === 'object' ? override.destination : override)
            : null;
        const destination = { ...(area.destination || {}) };
        if (destinationOverride) {
            for (const axis of ['x', 'y', 'z']) {
                const parsed = finite(destinationOverride[axis]);
                if (parsed !== null) destination[axis] = parsed;
            }
        }
        return { ...area, destination };
    }) : [];

    const movement = { ...(base.movement || {}) };
    const pitch = finite(overrides.shoreFishingPitchDegrees);
    if (pitch !== null) movement.shoreFishingPitchDegrees = pitch;

    const resolved = {
        ...base,
        movement,
        areas
    };
    const validation = fishingSchema(resolved);
    if (!validation.valid) throw new Error(`Resolved fishing config is invalid: ${validation.errors.join('; ')}`);
    return resolved;
}

module.exports = resolveFishingConfig;
