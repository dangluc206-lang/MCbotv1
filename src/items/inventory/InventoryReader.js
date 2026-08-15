'use strict';

const InventorySnapshot = require('./InventorySnapshot');

class InventoryReader {
    constructor({ botId, context, normalizer, logger = null }) {
        Object.assign(this, { botId, context, normalizer, logger });
    }

    read(options = {}) {
        const views = this.readViews(options);
        return views.find(view => view.source === 'current-window')
            || views.find(view => view.source === 'bot-inventory')
            || new InventorySnapshot({ botId: this.botId, items: [], slotCount: 0, emptySlotCount: 0 });
    }

    readBotInventory(options = {}) {
        const bot = this.context.require();
        const inventorySlots = bot.inventory?.slots || [];
        return this.#readSlots({
            bot,
            slots: inventorySlots,
            start: 0,
            end: inventorySlots.length,
            source: 'bot-inventory',
            windowId: null,
            preserveAbsoluteSlots: false,
            options
        });
    }

    readViews(options = {}) {
        const bot = this.context.require();
        const views = [];
        const currentWindow = bot.currentWindow || null;
        const windowRange = this.#playerInventoryRange(currentWindow);

        // Keep both representations. Some custom GUI plugins update the
        // player-inventory section of currentWindow first, while others leave
        // that section stale and Mineflayer's bot.inventory is fresher after
        // the click. Verifiers can compare both instead of trusting one source.
        if (windowRange) {
            views.push(this.#readSlots({
                bot,
                slots: currentWindow.slots,
                start: windowRange.start,
                end: windowRange.end,
                source: 'current-window',
                windowId: currentWindow.id ?? null,
                preserveAbsoluteSlots: true,
                options
            }));
        }

        views.push(this.readBotInventory(options));

        return views;
    }

    #readSlots({ bot, slots, start, end, source, windowId, preserveAbsoluteSlots, options = {} }) {
        const items = [];
        let emptySlotCount = 0;
        const safeStart = Math.max(0, Number(start) || 0);
        const safeEnd = Math.max(safeStart, Math.min(Number(end) || 0, slots.length));
        const debugSamples = [];

        for (let slot = safeStart; slot < safeEnd; slot += 1) {
            const item = slots[slot];
            if (!item) {
                emptySlotCount += 1;
                continue;
            }
            const normalized = this.normalizer.normalize(item);
            if (!normalized) continue;

            const { raw: _raw, ...stable } = normalized;
            if (options.debugMetadataReason && debugSamples.length < Math.max(1, Number(options.debugMaxItems) || 8)) {
                const identities = [...(stable.identityComponents || []), ...(stable.identityNbt || [])];
                const focus = String(options.debugFocusIdentity || '');
                const focusMatched = Boolean(focus) && identities.some(value => String(value) === focus);
                const requestedSlots = Array.isArray(options.debugSlots?.[source]) ? options.debugSlots[source] : [];
                const changedSlot = requestedSlots.includes(slot);
                const unrestricted = requestedSlots.length === 0 && !focus;
                const shouldSample = requestedSlots.length > 0
                    ? (changedSlot || focusMatched)
                    : (focusMatched || stable.customMetadataPresent || unrestricted);
                if (shouldSample) {
                    debugSamples.push(this.#metadataDebugSample(item, stable, { source, slot, playerSlot: preserveAbsoluteSlots ? slot - safeStart : slot }));
                }
            }
            items.push({
                slot: preserveAbsoluteSlots ? slot : slot,
                playerSlot: preserveAbsoluteSlots ? slot - safeStart : slot,
                ...stable
            });
        }

        if (options.debugMetadataReason && debugSamples.length > 0) {
            for (const sample of debugSamples) {
                this.logger?.info?.(`Inventory metadata ${sample.source} slot=${sample.slot} name=${sample.name}.`, {
                    botId: this.botId,
                    reason: options.debugMetadataReason,
                    nbtState: sample.nbtState,
                    componentsState: sample.componentsState,
                    identityComponents: sample.identityComponents,
                    componentMapState: sample.componentMapState,
                    customDataState: sample.customDataState,
                    customMetadataPresent: sample.customMetadataPresent,
                    count: sample.count,
                    playerSlot: sample.playerSlot,
                    nbtKeys: sample.nbtKeys,
                    componentKeys: sample.componentKeys,
                    componentMapKeys: sample.componentMapKeys,
                    customDataKeys: sample.customDataKeys
                });
            }
        }

        if (source === 'bot-inventory') {
            const reportedEmpty = bot.inventory?.emptySlotCount?.();
            if (Number.isInteger(reportedEmpty)) emptySlotCount = reportedEmpty;
        }

        return new InventorySnapshot({
            botId: this.botId,
            items,
            slotCount: safeEnd - safeStart,
            emptySlotCount,
            source,
            windowId,
            inventoryStart: source === 'current-window' ? safeStart : null,
            inventoryEnd: source === 'current-window' ? safeEnd : null
        });
    }


    #metadataDebugSample(raw, normalized, { source, slot, playerSlot }) {
        const state = value => value === undefined ? 'undefined' : value === null ? 'null' : 'present';
        const keys = value => {
            if (!value || typeof value !== 'object') return [];
            const candidate = value?.value && typeof value.value === 'object' ? value.value : value;
            try { return Object.keys(candidate).slice(0, 12); } catch { return []; }
        };
        return {
            source,
            slot,
            playerSlot,
            name: normalized.name,
            count: normalized.count,
            displayName: normalized.displayName,
            nbtState: state(raw.nbt),
            nbtKeys: keys(raw.nbt),
            componentsState: state(raw.components),
            componentKeys: keys(raw.components),
            componentMapState: state(raw.componentMap),
            componentMapKeys: keys(raw.componentMap),
            customDataState: state(raw.customData),
            customDataKeys: keys(raw.customData),
            identityComponents: normalized.identityComponents || [],
            identityNbt: normalized.identityNbt || [],
            customMetadataPresent: Boolean(normalized.customMetadataPresent)
        };
    }

    #playerInventoryRange(window) {
        if (!window || !Array.isArray(window.slots)) return null;
        const start = Number(window.inventoryStart);
        if (!Number.isInteger(start) || start < 0 || start >= window.slots.length) return null;

        const configuredEnd = Number(window.inventoryEnd);
        const end = Number.isInteger(configuredEnd) && configuredEnd > start
            ? Math.min(configuredEnd, window.slots.length)
            : window.slots.length;
        if (end <= start) return null;
        return { start, end };
    }
}

module.exports = InventoryReader;
