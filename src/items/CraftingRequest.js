'use strict';

const ALL = 'ALL';

const ERROR_CODES = Object.freeze({
    ITEM: 'CRAFTING_REQUEST_ITEM_UNKNOWN',
    QUANTITY: 'CRAFTING_REQUEST_QUANTITY_INVALID',
    REGISTRY: 'CRAFTING_REQUEST_REGISTRY_REQUIRED'
});

function fail(code, message) {
    throw Object.assign(new TypeError(message), { code });
}

function normalizeQuantity(raw) {
    if (typeof raw === 'string' && raw.trim().toLowerCase() === ALL.toLowerCase()) {
        return { quantityMode: ALL, quantity: null };
    }
    const value = typeof raw === 'string' ? Number(raw.trim()) : raw;
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        fail(ERROR_CODES.QUANTITY, `Crafting request quantity must be a positive integer or "${ALL}", got: ${String(raw)}.`);
    }
    return { quantityMode: 'FIXED', quantity: value };
}

/**
 * Shared request model for "craft item X in quantity Y".
 * targetItemId is always a real in-game item id (display names are resolved
 * through the item registry); ALL is a quantity mode, never a sentinel number.
 */
class CraftingRequest {
    static create({ targetItemId, quantity, itemRegistry } = {}) {
        if (!itemRegistry || typeof itemRegistry.resolveById !== 'function') {
            fail(ERROR_CODES.REGISTRY, 'CraftingRequest requires a CraftingItemRegistry.');
        }
        const key = String(targetItemId ?? '').trim();
        if (!key) fail(ERROR_CODES.ITEM, 'Crafting request targetItemId is required.');
        const entry = itemRegistry.resolveById(key) || itemRegistry.resolveByDisplayName(key);
        if (!entry) fail(ERROR_CODES.ITEM, `Crafting request target item is not known: ${key}.`);
        const normalized = normalizeQuantity(quantity);
        return Object.freeze({
            targetItemId: entry.id,
            targetDisplayName: entry.displayName,
            quantityMode: normalized.quantityMode,
            quantity: normalized.quantity
        });
    }

    static isAll(request) {
        return request?.quantityMode === ALL;
    }
}

CraftingRequest.ALL = ALL;
CraftingRequest.ERROR_CODES = ERROR_CODES;
module.exports = CraftingRequest;
