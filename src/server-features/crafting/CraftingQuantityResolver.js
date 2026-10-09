'use strict';

const StorageTextParser = require('../storage/StorageTextParser');

class CraftingQuantityResolver {
    constructor(config = {}, { textParser = new StorageTextParser() } = {}) {
        this.config = config;
        this.textParser = textParser;
    }

    resolve(amount, window = null) {
        const quantity = this.#normalizeQuantity(amount);
        const resolved = this.#tryResolve(window, quantity);
        if (resolved !== null) return resolved.slot;
        throw new Error(`Crafting quantity slot is not configured or detectable: ${quantity}. ${this.#describe(window)}`);
    }

    #tryResolve(window, quantity) {
        // Live GUI first; configured slot only as bootstrap/fallback.
        const detected = this.#detect(window, quantity);
        if (Number.isInteger(detected)) return { slot: detected, source: 'live' };
        const configured = this.config.quantitySlots?.[String(quantity)];
        if (Number.isInteger(configured) && window?.slots?.[configured]) return { slot: configured, source: 'configured' };
        return null;
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

    /**
     * G12.1: verified GUI quantity capabilities.
     * Returns the frozen list of single-click craft actions the CURRENT live
     * window provably supports, live detection first, configured slots as
     * fallback. Each entry is { amount, slot, source } where source is
     * 'live' or 'configured'. ALL is never included: it is not a fixed-size
     * batch and must not be used to satisfy an exact numeric request.
     */
    describeActions(window = null) {
        const actions = [];
        for (const amount of [64, 1]) {
            const resolved = this.#tryResolve(window, amount);
            if (resolved !== null) actions.push(Object.freeze({ amount, ...resolved }));
        }
        return Object.freeze(actions.sort((a, b) => b.amount - a.amount));
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
        if (amount === 'ALL') return 'ALL';
        if (typeof amount === 'string' && amount.trim().toUpperCase() === 'ALL') return 'ALL';
        // G10/G11: exact quantity. GUI buttons (1/64) are server capabilities,
        // not architecture limits — higher-level batching repeats them to stay exact.
        const value = Number(amount);
        if (Number.isSafeInteger(value) && value >= 1) return value;
        throw new RangeError('Crafting quantity must be a positive integer or ALL.');
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
