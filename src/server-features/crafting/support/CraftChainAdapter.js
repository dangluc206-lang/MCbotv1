'use strict';

// Pure legacy -> generic chain-field adapter (Slice 6 Step 1).
//
// Mirrors the current production translation (B5PlanningService #legacyChain,
// inverted): same field pairs, same missing-field behavior (absent stays a
// null identity / zero count / dropped state key), same frozen output.
// Pure + deterministic: no IO, no config, no planning logic, never mutates
// its input. Legacy-only `compactableB1`/`plannedB2Exact` are intentionally
// dropped, never promoted into the generic contract (verified: the live
// generic chain from CraftPlanningService never carries them).

const IDENTITY_MAP = Object.freeze([
    ['baseId', 'baseId'],
    ['b2Id', 'intermediateId'],
    ['b3Id', 'outputId'],
    ['b2RecipeId', 'intermediateRecipeId'],
    ['b3RecipeId', 'outputRecipeId']
]);

const QUANTITY_MAP = Object.freeze([
    ['b2Crafts', 'intermediateCrafts'],
    ['b3Crafts', 'outputCrafts'],
    ['vaultB2', 'vaultIntermediate'],
    ['vaultB3', 'vaultOutput'],
    ['inventoryB2', 'inventoryIntermediate'],
    ['inventoryB3', 'inventoryOutput'],
    ['b3InputPerCraft', 'intermediatePerOutput'],
    ['b2OutputAmount', 'intermediateOutputAmount'],
    ['rawPerB3', 'basePerOutput'],
    ['rawNeededFromStorage', 'baseNeededFromStorage']
]);

// Planning state shared by both shapes (legacy name -> generic name).
const STATE_MAP = Object.freeze([
    ['storedLoose', 'storedLoose'],
    ['inventoryB1', 'inventoryBase'],
    ['storageEffective', 'storageEffective'],
    ['storageTotalEffective', 'storageTotalEffective'],
    ['storedEffective', 'storedEffective'],
    ['storedTotalEffective', 'storedTotalEffective'],
    ['immediateMissingRaw', 'immediateMissingRaw'],
    ['missingRaw', 'missingRaw'],
    ['decompressionBlocked', 'decompressionBlocked'],
    ['readyToReserve', 'readyToReserve']
]);

function text(value, fallback = null) {
    const normalized = String(value ?? '').trim();
    return normalized || fallback;
}

function count(value, fallback = 0) {
    const numeric = Number(value ?? fallback);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function fromLegacyChain(chain = {}) {
    const source = chain && typeof chain === 'object' ? chain : {};
    const generic = {};
    for (const [legacyKey, genericKey] of IDENTITY_MAP) {
        generic[genericKey] = text(source[legacyKey], null);
    }
    for (const [legacyKey, genericKey] of QUANTITY_MAP) {
        generic[genericKey] = count(source[legacyKey], 0);
    }
    if (generic.intermediateOutputAmount <= 0) generic.intermediateOutputAmount = 1;
    for (const [legacyKey, genericKey] of STATE_MAP) {
        if (source[legacyKey] === undefined) continue;
        generic[genericKey] = genericKey === 'decompressionBlocked' || genericKey === 'readyToReserve'
            ? source[legacyKey] === true
            : count(source[legacyKey], 0);
    }
    return Object.freeze(generic);
}

function isGenericChain(chain = {}) {
    const source = chain && typeof chain === 'object' ? chain : {};
    return typeof source.intermediateId === 'string'
        && typeof source.outputId === 'string'
        && !('b2Id' in source)
        && !('b3Id' in source);
}

module.exports = Object.freeze({
    fromLegacyChain,
    isGenericChain,
    IDENTITY_MAP,
    QUANTITY_MAP
});
