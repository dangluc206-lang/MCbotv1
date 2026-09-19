'use strict';

const TIER_IDS = Object.freeze(['B1', 'B2', 'B3', 'B4', 'B5']);
const SCHEMA_VERSION = 1;

function fail(message) {
    throw Object.assign(new TypeError(message), { code: 'CRAFTING_TARGET_POLICY_INVALID' });
}

function idList(value, path) {
    if (value === undefined) return Object.freeze([]);
    if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string' || !entry.trim())) {
        fail(`${path} must be an array of non-empty item ids.`);
    }
    return Object.freeze([...new Set(value.map(entry => entry.trim()))]);
}

function normalizeOverrides(value) {
    if (value === undefined) return Object.freeze({});
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('craftingTargets.overrides must be an object.');
    const normalized = {};
    for (const [itemId, override] of Object.entries(value)) {
        if (!itemId.trim()) fail('craftingTargets.overrides keys must be non-empty item ids.');
        if (!override || typeof override !== 'object' || Array.isArray(override)) fail(`craftingTargets.overrides.${itemId} must be an object.`);
        for (const key of Object.keys(override)) {
            if (!['enabled', 'displayName'].includes(key)) fail(`craftingTargets.overrides.${itemId}.${key} is not allowed.`);
        }
        if (override.enabled !== undefined && typeof override.enabled !== 'boolean') fail(`craftingTargets.overrides.${itemId}.enabled must be boolean.`);
        if (override.displayName !== undefined && (typeof override.displayName !== 'string' || !override.displayName.trim())) {
            fail(`craftingTargets.overrides.${itemId}.displayName must be a non-empty string.`);
        }
        normalized[itemId.trim()] = Object.freeze({
            enabled: override.enabled === undefined ? null : override.enabled,
            displayName: override.displayName === undefined ? null : override.displayName.trim()
        });
    }
    return Object.freeze(normalized);
}

function normalizePolicy(policy) {
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) fail('craftingTargets policy object is required.');
    if (policy.schemaVersion !== undefined && policy.schemaVersion !== SCHEMA_VERSION) {
        fail(`craftingTargets.schemaVersion must be ${SCHEMA_VERSION}.`);
    }
    for (const key of Object.keys(policy)) {
        if (!['schemaVersion', 'allowedTiers', 'allowItems', 'denyItems', 'overrides'].includes(key)) {
            fail(`craftingTargets.${key} is not allowed.`);
        }
    }
    const allowedTiersRaw = policy.allowedTiers === undefined ? [] : policy.allowedTiers;
    if (!Array.isArray(allowedTiersRaw) || allowedTiersRaw.some(tier => !TIER_IDS.includes(tier))) {
        fail(`craftingTargets.allowedTiers must be an array of ${TIER_IDS.join('/')}.`);
    }
    const allowItems = idList(policy.allowItems, 'craftingTargets.allowItems');
    const denyItems = idList(policy.denyItems, 'craftingTargets.denyItems');
    const conflicting = allowItems.filter(itemId => denyItems.includes(itemId));
    if (conflicting.length) fail(`craftingTargets allowItems and denyItems overlap: ${conflicting.join(', ')}.`);
    return Object.freeze({
        allowedTiers: Object.freeze([...new Set(allowedTiersRaw)]),
        allowItems,
        denyItems: Object.freeze(new Set(denyItems)),
        overrides: normalizeOverrides(policy.overrides)
    });
}
/**
 * Read-only view of the operator-selectable craft targets. Policy (which items
 * may be requested) comes from configuration data only; this class never
 * hard-codes an item id. CraftingItemRegistry keeps owning item/recipe identity;
 * this registry only decides which of those items are offerable targets.
 */
class CraftingTargetRegistry {
    constructor({ craftingItemRegistry, policy } = {}) {
        if (!craftingItemRegistry || typeof craftingItemRegistry.items !== 'function') {
            throw new TypeError('CraftingTargetRegistry requires CraftingItemRegistry.');
        }
        this.craftingItemRegistry = craftingItemRegistry;
        this.policy = normalizePolicy(policy);
        this.#byId = buildTargets(craftingItemRegistry, this.policy);
    }

    #byId;

    ids() {
        return Object.freeze([...this.#byId.keys()]);
    }

    targets() {
        return Object.freeze([...this.#byId.values()]);
    }

    resolveById(id) {
        const itemId = String(id || '').trim();
        return itemId ? this.#byId.get(itemId) || null : null;
    }

    requireById(id) {
        const entry = this.resolveById(id);
        if (!entry) {
            throw Object.assign(new Error(`Crafting target not found: ${id}`), { code: 'CRAFTING_TARGET_UNKNOWN' });
        }
        return entry;
    }

    isTarget(id) {
        return this.resolveById(id) !== null;
    }

    descriptor() {
        return Object.freeze({
            contract: 'crafting-target-registry-v1',
            allowedTiers: Object.freeze([...this.policy.allowedTiers]),
            allowItems: Object.freeze([...this.policy.allowItems]),
            denyItems: Object.freeze([...this.policy.denyItems]),
            targetIds: this.ids()
        });
    }
}

function buildTargets(craftingItemRegistry, policy) {
    const byId = new Map();
    for (const entry of craftingItemRegistry.items()) {
        const itemId = String(entry?.id || '').trim();
        if (!itemId) continue;
        const override = policy.overrides[itemId] || null;
        if (override?.enabled === false || policy.denyItems.has(itemId)) continue;
        const explicitlyAllowed = override?.enabled === true || policy.allowItems.includes(itemId);
        if (!explicitlyAllowed && !policy.allowedTiers.includes(entry.tier)) continue;
        // A target without a producing recipe is not craftable, so it is never offered.
        if (!entry.recipe) continue;
        const outputAmount = Number(entry.recipe.outputAmount);
        if (!Number.isInteger(outputAmount) || outputAmount <= 0) continue;
        byId.set(itemId, Object.freeze({
            id: itemId,
            displayName: override?.displayName || entry.displayName || itemId,
            recipe: entry.recipe,
            outputAmount,
            tier: entry.tier,
            classifications: Object.freeze([...(entry.classifications || [])]),
            identities: Object.freeze([...(entry.identities || [])])
        }));
    }
    return byId;
}

CraftingTargetRegistry.SCHEMA_VERSION = SCHEMA_VERSION;
CraftingTargetRegistry.TIER_IDS = TIER_IDS;
module.exports = CraftingTargetRegistry;