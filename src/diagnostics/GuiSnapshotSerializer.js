'use strict';

const TitleTextExtractor = require('../gui/detection/TitleTextExtractor');

class GuiSnapshotSerializer {
    constructor({ maxDepth = 12, maxArrayLength = 512, maxStringLength = 32768, titleTextExtractor = new TitleTextExtractor() } = {}) {
        this.maxDepth = maxDepth;
        this.maxArrayLength = maxArrayLength;
        this.maxStringLength = maxStringLength;
        this.titleTextExtractor = titleTextExtractor;
    }

    serialize({ botId, commandKey, commandDisplay, connectionGeneration, session }) {
        if (!session?.window) throw new TypeError('A GUI session with a window is required.');

        const window = session.window;
        const items = [];
        for (let slot = 0; slot < (window.slots?.length || 0); slot += 1) {
            const item = window.slots[slot];
            if (!item) continue;
            items.push(this.#serializeItem(item, slot));
        }

        return Object.freeze({
            capturedAt: new Date().toISOString(),
            botId,
            commandKey,
            command: commandDisplay,
            connectionGeneration,
            gui: Object.freeze({
                sessionId: session.id,
                definitionId: session.definitionId || null,
                title: this.#toSafeValue(window.title),
                titleText: this.titleTextExtractor.extract(window.title),
                type: window.type || null,
                id: window.id ?? null,
                slotCount: window.slots?.length || 0,
                inventoryStart: window.inventoryStart ?? null,
                inventoryEnd: window.inventoryEnd ?? null,
                selectedItemCount: items.length,
                emptySlotCount: Math.max(0, (window.slots?.length || 0) - items.length)
            }),
            items: Object.freeze(items)
        });
    }

    #serializeItem(item, slot) {
        return Object.freeze({
            slot,
            name: item.name || null,
            displayName: this.#toSafeValue(item.displayName || item.customName || null),
            count: item.count ?? 0,
            type: item.type ?? null,
            metadata: item.metadata ?? null,
            stackSize: item.stackSize ?? null,
            durabilityUsed: item.durabilityUsed ?? null,
            maxDurability: item.maxDurability ?? null,
            lore: this.#toSafeValue(item.lore || []),
            enchants: this.#toSafeValue(item.enchants || []),
            customModelData: item.customModelData ?? null,
            nbt: this.#toSafeValue(item.nbt || null)
        });
    }

    #toSafeValue(value, depth = 0, seen = new WeakSet()) {
        if (value === null || value === undefined) return value ?? null;
        if (typeof value === 'bigint') return value.toString();
        if (typeof value === 'string') {
            return value.length > this.maxStringLength
                ? `${value.slice(0, this.maxStringLength)}…[truncated]`
                : value;
        }
        if (typeof value === 'number' || typeof value === 'boolean') return value;
        if (typeof value === 'function' || typeof value === 'symbol') return String(value);
        if (Buffer.isBuffer(value)) {
            const limit = Math.min(value.length, this.maxStringLength);
            const suffix = value.length > limit ? '…[truncated]' : '';
            return `${value.subarray(0, limit).toString('hex')}${suffix}`;
        }
        if (depth >= this.maxDepth) return '[MaxDepth]';
        if (typeof value !== 'object') return String(value);
        if (seen.has(value)) return '[Circular]';

        seen.add(value);
        if (Array.isArray(value)) {
            const output = value
                .slice(0, this.maxArrayLength)
                .map(entry => this.#toSafeValue(entry, depth + 1, seen));
            if (value.length > this.maxArrayLength) output.push(`[${value.length - this.maxArrayLength} more entries]`);
            seen.delete(value);
            return output;
        }

        const output = {};
        for (const [key, child] of Object.entries(value)) {
            output[key] = this.#toSafeValue(child, depth + 1, seen);
        }
        seen.delete(value);
        return output;
    }
}

module.exports = GuiSnapshotSerializer;
