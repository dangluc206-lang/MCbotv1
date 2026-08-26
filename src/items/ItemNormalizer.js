'use strict';

const { describeItemIdentity } = require('./ItemIdentity');

class ItemNormalizer {
    normalize(item) {
        if (!item) return null;
        const nbt = item.nbt?.value || item.nbt || {};
        const displayName = item.displayName || item.displayNameRaw || item.customName || item.name || item.carrier || '';
        const lore = item.lore || item.loreRaw || nbt?.display?.value?.Lore?.value?.value || [];
        const componentIdentity = describeItemIdentity({
            customIdentifier: item.customIdentifier,
            identifier: item.identifier,
            components: item.components,
            componentMap: item.componentMap,
            customData: item.customData
        });
        const nbtIdentity = describeItemIdentity({ nbt: item.nbt });
        const providedComponentIds = Array.isArray(item.identityComponents) ? item.identityComponents.map(String) : [];
        const providedNbtIds = Array.isArray(item.identityNbt) ? item.identityNbt.map(String) : [];
        const providedStructuralKeys = Array.isArray(item.identityStructuralKeys) ? item.identityStructuralKeys.map(String) : [];
        return Object.freeze({
            name: item.name || item.itemName || item.carrier || '',
            type: item.type ?? null,
            count: item.count ?? 0,
            maxStackSize: Number.isInteger(Number(item.maxStackSize)) && Number(item.maxStackSize) > 0
                ? Number(item.maxStackSize)
                : 64,
            metadata: item.metadata ?? null,
            displayName: String(displayName),
            lore: Array.isArray(lore) ? lore.map(String) : [],
            identityComponents: [...new Set([...providedComponentIds, ...componentIdentity.semanticIds])],
            identityNbt: [...new Set([...providedNbtIds, ...nbtIdentity.semanticIds])],
            identityStructuralKeys: [...new Set([
                ...providedStructuralKeys,
                ...componentIdentity.structuralKeys,
                ...nbtIdentity.structuralKeys
            ])],
            customMetadataPresent: Boolean(item.customMetadataPresent)
                || providedComponentIds.length > 0
                || providedNbtIds.length > 0
                || componentIdentity.customMetadataPresent
                || nbtIdentity.customMetadataPresent,
            nbt,
            raw: item
        });
    }
}

module.exports = ItemNormalizer;
