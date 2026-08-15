'use strict';

const StorageTextParser = require('../storage/StorageTextParser');

class CraftingQuantityResolver {
    constructor(config = {}, { textParser = new StorageTextParser() } = {}) {
        this.config = config;
        this.textParser = textParser;
    }

    resolve(amount, window = null) {
        const quantity = this.#normalizeQuantity(amount);

        // Quantity buttons are a special case: two server buttons can use the
        // same carrier/custom item and differ only by numeric text (1 vs 64).
        // Always inspect the live GUI first. A configured slot is only a
        // bootstrap/fallback when semantic detection is unavailable.
        const detected = this.#detect(window, quantity);
        if (Number.isInteger(detected)) return detected;

        const configured = this.config.quantitySlots?.[String(quantity)];
        if (Number.isInteger(configured) && window?.slots?.[configured]) return configured;
        throw new Error(`Crafting quantity slot is not configured or detectable: ${quantity}. ${this.#describe(window)}`);
    }

    describeCandidates(window) {
        return this.#entries(window).map(entry => ({
            slot: entry.slot,
            name: entry.item?.name || null,
            count: Number(entry.item?.count || 0),
            text: String(entry.text || '').replace(/\s+/g, ' ').trim(),
            isAll: entry.isAll
        }));
    }

    #detect(window, amount) {
        const entries = this.#entries(window);
        if (entries.length === 0) return null;

        if (amount === 'ALL') {
            const all = entries.filter(entry => entry.isAll && this.#isActionCandidate(entry));
            if (all.length === 1) return all[0].slot;
            return null;
        }

        // 1) Strongest signal: the button text/lore/components explicitly say
        // the requested amount. StorageTextParser understands customLore/NBT/
        // components, so resource-pack/component formatted buttons are covered.
        const explicit = entries.filter(entry => !entry.isAll && this.#mentionsAmount(entry.text, amount));
        if (explicit.length === 1) return explicit[0].slot;

        // 2) Many servers represent "64" literally as a stack of 64 while
        // keeping the visible name generic. This is safe for 64 because normal
        // GUI decoration stacks are rarely exactly 64 AND there is only one
        // quantity button with that stack size.
        if (amount === 64) {
            const stack64 = entries.filter(entry => !entry.isAll && Number(entry.item?.count) === 64);
            if (stack64.length === 1) return stack64[0].slot;
        }

        // 3) Semantic elimination for the known three-choice server GUI:
        // 1 / 64 / ALL. If 1 and ALL are identifiable and exactly one other
        // meaningful candidate remains, that remaining button is 64.
        if (amount === 64) {
            const oneSlots = new Set(entries
                .filter(entry => !entry.isAll && this.#mentionsAmount(entry.text, 1))
                .map(entry => entry.slot));
            const remaining = entries.filter(entry => !entry.isAll && !oneSlots.has(entry.slot) && this.#isActionCandidate(entry));
            if (remaining.length === 1) return remaining[0].slot;
        }

        // For amount=1, stack count alone is too ambiguous (decorations often
        // have count 1), so only use it when the whole container exposes a
        // single non-ALL count=1 candidate with useful text.
        if (amount === 1) {
            const stack1 = entries.filter(entry => !entry.isAll && Number(entry.item?.count) === 1 && this.#hasUsefulText(entry));
            if (stack1.length === 1) return stack1[0].slot;
        }

        return null;
    }


    #normalizeQuantity(amount) {
        if (amount === 1 || amount === 64) return amount;
        if (typeof amount === 'string' && amount.trim().toUpperCase() === 'ALL') return 'ALL';
        throw new RangeError('Only crafting quantities 1, 64 and ALL are supported.');
    }

    #entries(window) {
        const slots = Array.isArray(window?.slots) ? window.slots : [];
        const end = Number.isInteger(window?.inventoryStart) && window.inventoryStart >= 0
            ? Math.min(window.inventoryStart, slots.length)
            : slots.length;
        const result = [];
        for (let slot = 0; slot < end; slot += 1) {
            const item = slots[slot];
            if (!item) continue;
            const text = this.textParser.itemText(item);
            result.push({
                slot,
                item,
                text,
                isAll: /\ball\b|tat\s*ca|toan\s*bo|everything|maximum|max\b/.test(text)
            });
        }
        return result;
    }

    #mentionsAmount(text, amount) {
        if (!text) return false;
        const regex = new RegExp(`(^|[^0-9])${amount}([^0-9]|$)`);
        return regex.test(text);
    }

    #hasUsefulText(entry) {
        if (!entry?.text) return false;
        const name = String(entry.item?.name || '').toLowerCase();
        // Plain filler panes are not quantity actions even if their count is 1.
        if (/glass_pane|stained_glass_pane/.test(name)) return false;
        return entry.text.length > 0;
    }

    #isActionCandidate(entry) {
        if (!this.#hasUsefulText(entry)) return false;
        const name = String(entry.item?.name || '').toLowerCase();
        if (/air|barrier/.test(name)) return false;
        return true;
    }

    #describe(window) {
        const entries = this.#entries(window);
        const compact = entries.slice(0, 24).map(entry => {
            const text = String(entry.text || '').replace(/\s+/g, ' ').slice(0, 60);
            return `${entry.slot}:${entry.item?.name || '?'}x${entry.item?.count ?? '?'}:${JSON.stringify(text)}`;
        });
        return `inventoryStart=${Number.isInteger(window?.inventoryStart) ? window.inventoryStart : 'unknown'} candidates=[${compact.join(', ')}]`;
    }
}

module.exports = CraftingQuantityResolver;
