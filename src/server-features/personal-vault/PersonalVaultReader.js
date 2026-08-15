'use strict';

const PersonalVaultSnapshot = require('./PersonalVaultSnapshot');

class PersonalVaultReader {
    constructor({ itemResolver, guiKnowledge = null, normalizer = null, storageSlots = 54 }) {
        this.itemResolver = itemResolver;
        this.guiKnowledge = guiKnowledge;
        this.normalizer = normalizer;
        this.storageSlots = storageSlots;
    }

    read(window) {
        const items = [];
        const totals = {};
        const end = Math.min(this.storageSlots, window?.slots?.length || 0);
        for (let slot = 0; slot < end; slot += 1) {
            const raw = window.slots[slot];
            if (!raw) continue;
            const logicalId = this.guiKnowledge?.resolveLogicalId(raw, 'personal-vault')
                || this.itemResolver.resolve(raw, 'personal-vault')?.id
                || null;
            this.#append(items, totals, raw, slot, logicalId);
        }
        return new PersonalVaultSnapshot({
            items, totals, slotCount: end, occupiedSlotCount: items.length, emptySlotCount: Math.max(0, end - items.length)
        });
    }

    async readAndLearn(window, { source = 'personal-vault-read' } = {}) {
        const items = [];
        const totals = {};
        const end = Math.min(this.storageSlots, window?.slots?.length || 0);
        for (let slot = 0; slot < end; slot += 1) {
            const raw = window.slots[slot];
            if (!raw) continue;
            const logicalId = this.guiKnowledge?.resolveAndLearnLogicalId
                ? await this.guiKnowledge.resolveAndLearnLogicalId(raw, 'personal-vault', {
                    source,
                    roleId: `vault-slot:${slot}`
                })
                : (this.guiKnowledge?.resolveLogicalId(raw, 'personal-vault')
                    || this.itemResolver.resolve(raw, 'personal-vault')?.id
                    || null);
            this.#append(items, totals, raw, slot, logicalId);
        }
        return new PersonalVaultSnapshot({
            items, totals, slotCount: end, occupiedSlotCount: items.length, emptySlotCount: Math.max(0, end - items.length)
        });
    }

    #append(items, totals, raw, slot, logicalId) {
        const count = Number(raw.count || 0);
        const normalized = this.normalizer?.normalize?.(raw) || null;
        const fingerprint = this.guiKnowledge?.normalizer?.fingerprintItem?.(raw) || null;
        items.push({
            slot,
            logicalId,
            count,
            rawName: raw.name,
            identityComponents: normalized?.identityComponents || fingerprint?.identityComponents || [],
            identityNbt: normalized?.identityNbt || fingerprint?.identityNbt || [],
            customMetadataPresent: Boolean(normalized?.customMetadataPresent)
        });
        if (logicalId) totals[logicalId] = (totals[logicalId] || 0) + count;
    }
}

module.exports = PersonalVaultReader;
