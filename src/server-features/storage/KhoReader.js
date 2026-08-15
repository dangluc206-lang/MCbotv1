'use strict';

const KhoSnapshot = require('./KhoSnapshot');
const StorageTextParser = require('./StorageTextParser');

class KhoReader {
    constructor({ itemResolver, capacityReader, config, textParser = new StorageTextParser() }) {
        Object.assign(this, { itemResolver, capacityReader, config, textParser });
    }

    read(window) {
        const items = {};
        const sources = {};
        const amountPatterns = this.config?.resourceAmountPatterns || [];

        for (let slot = 0; slot < (window?.slots?.length || 0); slot += 1) {
            const raw = window.slots[slot];
            if (!raw) continue;
            const resolved = this.itemResolver.resolve(raw, 'storage-menu');
            if (!resolved || resolved.id === this.config?.capacityIndicator?.itemId) continue;

            const lines = this.textParser.itemLines(raw);
            const text = this.textParser.normalizeText(lines.join('\n'));
            let amount = this.textParser.firstMatch(text, amountPatterns, 'value');
            if (amount === null) {
                amount = this.textParser.firstNumberAfterLabel(
                    lines,
                    /(?:dang\s*co|so\s*luong|amount)\s*:?/i
                );
            }
            if (amount === null && this.config?.allowStackCountFallback === true) {
                amount = Number.isSafeInteger(Number(raw.count)) ? Number(raw.count) : null;
            }
            if (amount === null) continue;

            items[resolved.id] = amount;
            sources[resolved.id] = Object.freeze({
                slot,
                displayName: String(raw.displayName || raw.name || ''),
                lines: Object.freeze([...lines])
            });
        }

        let capacity = this.capacityReader.read(window);
        const fallbackLimit = Number(this.config?.capacityIndicator?.fallbackLimit);
        const hasUsableRatio = Number.isFinite(Number(capacity?.usageRatio));
        if (!hasUsableRatio && Number.isSafeInteger(fallbackLimit) && fallbackLimit > 0) {
            // On this server /kho used-capacity is the sum of the stored item
            // amounts. Keep protection alive across cosmetic/layout changes of
            // the capacity indicator by deriving used from the same parsed item
            // telemetry, but mark it as derived so diagnostics can expose it.
            const used = Object.values(items).reduce((sum, amount) => {
                const value = Number(amount);
                return sum + (Number.isFinite(value) && value > 0 ? value : 0);
            }, 0);
            const free = Math.max(0, fallbackLimit - used);
            capacity = Object.freeze({
                used,
                free,
                limit: fallbackLimit,
                total: fallbackLimit,
                usedPercent: (used / fallbackLimit) * 100,
                freePercent: (free / fallbackLimit) * 100,
                usageRatio: used / fallbackLimit,
                derivedFromItems: true
            });
        }

        return new KhoSnapshot({ items, capacity, sources });
    }
}

module.exports = KhoReader;
