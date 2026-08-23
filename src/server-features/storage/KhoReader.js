'use strict';

const KhoSnapshot = require('./KhoSnapshot');
const StorageTextParser = require('./StorageTextParser');

class KhoReader {
    constructor({ itemResolver, capacityReader, config, textParser = new StorageTextParser() }) {
        Object.assign(this, { itemResolver, capacityReader, config, textParser });
    }

    reconfigure(config) {
        this.config = config || {};
        this.capacityReader?.reconfigure?.(this.config);
        return this;
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
        const itemUsed = Object.values(items).reduce((sum, amount) => {
            const value = Number(amount);
            return sum + (Number.isFinite(value) && value > 0 ? value : 0);
        }, 0);

        // Capacity text is advisory until it is internally consistent with the
        // resource totals parsed from the same /kho window. A server revision
        // can expose only percentages (for example "Đã sử dụng: 100.0%");
        // older parsing interpreted 100.0 as the integer 1000. Reject any
        // absolute telemetry that cannot even contain the visible item totals.
        const parsedUsed = Number(capacity?.used);
        const parsedFree = Number(capacity?.free);
        const parsedLimit = Number(capacity?.limit ?? capacity?.total);
        const hasUsableRatio = Number.isFinite(Number(capacity?.usageRatio));
        const capacityContradictsItems = hasUsableRatio && (
            (Number.isFinite(parsedUsed) && parsedUsed + 1e-9 < itemUsed)
            || (Number.isFinite(parsedLimit) && parsedLimit + 1e-9 < itemUsed)
            || (Number.isFinite(parsedUsed) && Number.isFinite(parsedFree) && Number.isFinite(parsedLimit)
                && Math.abs((parsedUsed + parsedFree) - parsedLimit) > 1)
        );
        if (capacityContradictsItems) capacity = null;

        if ((!Number.isFinite(Number(capacity?.usageRatio))) && Number.isSafeInteger(fallbackLimit) && fallbackLimit > 0) {
            // On this server /kho used-capacity is the sum of the stored item
            // amounts. Keep protection alive across cosmetic/layout changes of
            // the capacity indicator by deriving used from the same parsed item
            // telemetry, but mark it as derived so diagnostics can expose it.
            const used = itemUsed;
            const free = Math.max(0, fallbackLimit - used);
            capacity = Object.freeze({
                used,
                free,
                limit: fallbackLimit,
                total: fallbackLimit,
                usedPercent: (used / fallbackLimit) * 100,
                freePercent: (free / fallbackLimit) * 100,
                usageRatio: used / fallbackLimit,
                derivedFromItems: true,
                rejectedTelemetry: capacityContradictsItems
            });
        }

        return new KhoSnapshot({ items, capacity, sources });
    }
}

module.exports = KhoReader;
