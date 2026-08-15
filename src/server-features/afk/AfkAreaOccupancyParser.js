'use strict';

class AfkAreaOccupancyParser {
    constructor({ itemNormalizer, config = {} }) {
        if (!itemNormalizer) throw new TypeError('itemNormalizer is required');
        this.itemNormalizer = itemNormalizer;
        this.config = config;

        // AFK server occupancy contract: the three AFK area slots expose only x/30.
        // Keep this intentionally strict so unrelated lore numbers cannot influence
        // area selection. Examples: 1/30, 13/30, 29/30, 30/30.
        this.occupancyPattern = /(?<!\d)(?<current>\d{1,2})\s*[/／]\s*30(?!\d)/i;
    }

    parse(item, area = {}) {
        const normalized = this.itemNormalizer.normalize(item);
        const text = this.#text(normalized);
        const match = this.occupancyPattern.exec(text);
        this.occupancyPattern.lastIndex = 0;

        const current = match ? Number(match.groups?.current ?? match[1]) : null;
        const capacity = match ? 30 : null;
        const known = Number.isFinite(current) && current >= 0 && current <= 30;

        return Object.freeze({
            current: known ? current : null,
            capacity: known ? capacity : null,
            known,
            full: known ? current >= 30 : null,
            text
        });
    }


    #text(normalized) {
        if (!normalized) return '';

        const parts = [];
        const seen = new Set();
        const add = value => {
            const plain = this.#plain(value);
            if (!plain || seen.has(plain)) return;
            seen.add(plain);
            parts.push(plain);
        };

        add(normalized.displayName);
        for (const lore of normalized.lore || []) add(lore);

        // prismarine-item 1.21+ exposes GUI lore through customLore/customName
        // getters backed by componentMap. These getters are on the prototype, so
        // Object.entries(raw) will not see them. Read them explicitly.
        const raw = normalized.raw;
        if (raw) {
            add(raw.customName);
            const customLore = raw.customLore;
            if (Array.isArray(customLore)) {
                for (const lore of customLore) add(lore);
            } else {
                add(customLore);
            }
        }

        // Modern Mineflayer/MC versions can expose display/lore as component objects.
        // ItemNormalizer intentionally stringifies lore for generic item matching, which
        // can turn those objects into "[object Object]". Read the original item as a
        // presentation fallback so visible text such as "13/30" is not lost.
        this.#collectPresentationText(normalized.raw, add);
        this.#collectPresentationText(normalized.nbt, add);

        return parts.join('\n');
    }

    #collectPresentationText(value, add, depth = 0, visited = new Set()) {
        if (value === null || value === undefined || depth > 12) return;

        if (typeof value === 'string') {
            add(value);
            const trimmed = value.trim();
            if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
                try { this.#collectPresentationText(JSON.parse(trimmed), add, depth + 1, visited); } catch {}
            }
            return;
        }

        if (typeof value !== 'object') return;
        if (visited.has(value)) return;
        visited.add(value);

        if (Array.isArray(value)) {
            for (const entry of value) this.#collectPresentationText(entry, add, depth + 1, visited);
            return;
        }

        if (value instanceof Map) {
            for (const [key, entry] of value.entries()) {
                this.#collectPresentationText(key, add, depth + 1, visited);
                this.#collectPresentationText(entry, add, depth + 1, visited);
            }
            return;
        }

        // Prefer fields commonly used by text components, item display/lore and NBT
        // wrappers. Then recurse through the remaining object values as a fallback;
        // only string leaves are collected, so numeric metadata cannot create fake x/y.
        const preferred = [
            'text', 'value', 'extra', 'with', 'translate',
            'displayName', 'displayNameRaw', 'customName', 'name',
            'lore', 'loreRaw', 'Lore', 'display',
            'components', 'componentMap', 'custom_name', 'customName',
            'minecraft:custom_name', 'minecraft:lore'
        ];

        const handled = new Set();
        for (const key of preferred) {
            if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
            handled.add(key);
            this.#collectPresentationText(value[key], add, depth + 1, visited);
        }
        for (const [key, entry] of Object.entries(value)) {
            if (handled.has(key)) continue;
            this.#collectPresentationText(entry, add, depth + 1, visited);
        }
    }

    #plain(value) {
        if (value === null || value === undefined) return '';
        if (typeof value === 'object') return this.#componentText(value).replace(/§[0-9A-FK-OR]/gi, '').trim();

        let text = String(value).replace(/§[0-9A-FK-OR]/gi, '');
        const trimmed = text.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            try { text = this.#componentText(JSON.parse(trimmed)); } catch {}
        }
        return String(text).replace(/§[0-9A-FK-OR]/gi, '').trim();
    }

    #componentText(value) {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' || typeof value === 'number') return String(value);
        if (Array.isArray(value)) return value.map(entry => this.#componentText(entry)).join('');
        if (typeof value !== 'object') return '';
        return [
            value.text,
            value.translate,
            value.with,
            value.extra,
            value.value,
            value.contents
        ].map(entry => this.#componentText(entry)).join('');
    }
}

module.exports = AfkAreaOccupancyParser;
