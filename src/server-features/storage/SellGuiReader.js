'use strict';

const StorageTextParser = require('./StorageTextParser');

/**
 * Reads only material entries actually exposed by the server's `/kho sell` GUI.
 * This GUI is not a complete storage snapshot: raw materials may be absent.
 * Full B1 coverage must therefore be computed from `/kho`, never from this reader.
 */
class SellGuiReader {
    constructor({ itemResolver, config, textParser = new StorageTextParser() }) {
        this.itemResolver = itemResolver;
        this.config = config || {};
        this.textParser = textParser;
        this.allowedLogicalIds = new Set(Object.keys(this.config?.sell?.itemAliases || {}));
    }

    reconfigure(config) {
        this.config = config || {};
        this.allowedLogicalIds = new Set(Object.keys(this.config?.sell?.itemAliases || {}));
        return this;
    }

    read(window) {
        const entries = {};
        const bySlot = {};
        const patterns = this.config?.sell?.amountPatterns || this.config?.resourceAmountPatterns || [];
        const slots = window?.slots || [];
        const inventoryStart = Number.isInteger(window?.inventoryStart) ? window.inventoryStart : slots.length;
        const end = Math.min(slots.length, inventoryStart);

        for (let slot = 0; slot < end; slot += 1) {
            const raw = slots[slot];
            if (!raw) continue;
            const resolved = this.itemResolver.resolve(raw, 'storage-menu')
                || this.itemResolver.resolve(raw, 'gui');
            const logicalId = resolved?.id || null;
            if (!logicalId || !this.allowedLogicalIds.has(logicalId)) continue;

            const lines = this.textParser.itemLines(raw);
            const normalizedLines = lines.map(line => this.textParser.normalizeText(line));
            // Sell items also contain click instructions such as "sell 1" and
            // "sell 64". Those numbers are action quantities, not storage
            // amounts. Filter instruction lines before applying amount parsers.
            const actionLine = /(?:\bban\b|\bchuot\b|\bclick\b|\bleft\b|\bright\b|\bshift\b|\btrai\b|\bphai\b)/i;
            const amountLines = normalizedLines.filter(line => !actionLine.test(line));
            const amountText = amountLines.join('\n');
            let amount = this.textParser.firstMatch(amountText, patterns, 'value');
            if (amount === null) {
                amount = this.textParser.firstNumberAfterLabel(
                    amountLines,
                    /(?:dang\s*co|so\s*luong|amount|trong\s*kho|storage)\s*:?/i
                );
            }
            // Zero is not trustworthy on this server's Sell GUI. Runtime has
            // shown `0` for a material that `/kho` simultaneously reported at
            // >90k blocks, most likely because a non-stock lore field matched an
            // amount pattern. Positive explicitly-labelled amounts may still be
            // useful as diagnostics, but storage planning never treats this GUI
            // as the authoritative full-stock source.
            const amountReliable = Number.isFinite(Number(amount)) && Number(amount) > 0;

            const entry = Object.freeze({
                logicalId,
                slot,
                amount: amountReliable ? Number(amount) : null,
                amountReliable,
                displayName: String(raw.displayName || raw.name || ''),
                lines: Object.freeze([...lines])
            });
            entries[logicalId] = entry;
            bySlot[slot] = entry;
        }

        return Object.freeze({
            entries: Object.freeze(entries),
            bySlot: Object.freeze(bySlot),
            capturedAt: new Date().toISOString()
        });
    }
}

module.exports = SellGuiReader;
