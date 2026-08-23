'use strict';

const TitleTextExtractor = require('../detection/TitleTextExtractor');
const { containerEnd } = require('../ContainerSlotRange');

class GuiStructureNormalizer {
    constructor({ itemNormalizer, titleTextExtractor = new TitleTextExtractor() }) {
        this.itemNormalizer = itemNormalizer;
        this.titleTextExtractor = titleTextExtractor;
    }

    normalize(session) {
        if (!session?.window) throw new TypeError('GUI session with window is required.');
        const window = session.window;
        const items = [];
        const guiEnd = containerEnd(window);
        for (let slot = 0; slot < guiEnd; slot += 1) {
            const raw = window.slots[slot];
            if (!raw) continue;
            items.push({ slot, ...this.fingerprintItem(raw) });
        }

        const titleText = this.titleTextExtractor.extract(window.title);
        return {
            identity: {
                definitionId: session.definitionId || null,
                titleText,
                type: window.type || null,
                slotCount: window.slots?.length || 0,
                inventoryStart: Number.isInteger(window.inventoryStart) ? window.inventoryStart : null,
                containerSlotCount: guiEnd
            },
            structure: { items },
            latest: {
                titleText,
                type: window.type || null,
                slotCount: window.slots?.length || 0,
                inventoryStart: Number.isInteger(window.inventoryStart) ? window.inventoryStart : null,
                containerSlotCount: guiEnd,
                items: this.#latestItems(window)
            }
        };
    }

    /**
     * Prefer a human-readable route key when the GUI came from a known command.
     * Examples:
     *   /sky               -> sky
     *   /ks + [22]         -> ks__slot-22
     *   /pv 2 + [10, 13]   -> pv-2__slot-10__slot-13
     */
    keyFor(normalized, { source = null } = {}) {
        const routeKey = this.routeKeyFor(source);
        if (routeKey) return routeKey;
        return this.legacyKeyFor(normalized);
    }

    routeKeyFor(source) {
        if (!source || typeof source !== 'object') return null;
        const command = typeof source.command === 'string' ? source.command.trim() : '';
        if (!command) return null;

        const commandKey = this.#commandSlug(command);
        if (!commandKey) return null;

        const actions = Array.isArray(source.actions)
            ? source.actions.filter(action => typeof action === 'string' && action.trim()).map(action => this.#safe(action))
            : [];
        if (actions.length > 0) return `${commandKey}${actions.map(action => `__${action}`).join('')}`;

        const clicks = Array.isArray(source.clicks)
            ? source.clicks.filter(slot => Number.isSafeInteger(slot) && slot >= 0)
            : [];
        if (clicks.length === 0) return commandKey;
        return `${commandKey}${clicks.map(slot => `__slot-${slot}`).join('')}`;
    }

    legacyKeyFor(normalized) {
        const identity = normalized.identity;
        if (identity.definitionId) return this.#safe(identity.definitionId);
        const title = this.#safe(identity.titleText || 'untitled');
        const type = this.#safe(identity.type || 'window');
        return `${title}__${type}__${identity.slotCount}`;
    }


    fingerprintItem(raw) {
        if (!raw) return null;
        const item = this.itemNormalizer.normalize(raw);
        return {
            name: item.name || null,
            displayName: this.#structuralText(item.displayName),
            lore: item.lore.map(line => this.#structuralText(line)),
            identityComponents: [...item.identityComponents],
            identityNbt: [...item.identityNbt],
            identityStructuralKeys: [...item.identityStructuralKeys],
            customModelData: raw.customModelData ?? null
        };
    }

    #latestItems(window) {
        const result = [];
        const end = containerEnd(window);
        for (let slot = 0; slot < end; slot += 1) {
            const raw = window.slots[slot];
            if (!raw) continue;
            const item = this.itemNormalizer.normalize(raw);
            result.push({
                slot,
                name: item.name || null,
                displayName: item.displayName,
                count: item.count,
                lore: [...item.lore],
                identityComponents: [...item.identityComponents],
                identityNbt: [...item.identityNbt],
                identityStructuralKeys: [...item.identityStructuralKeys],
                customMetadataPresent: item.customMetadataPresent,
                customModelData: raw.customModelData ?? null
            });
        }
        return result;
    }

    #structuralText(value) {
        return String(value || '')
            .replace(/§[0-9a-fk-or]/gi, '')
            .replace(/[\d][\d.,]*/g, '{#}')
            .replace(/\s+/g, ' ')
            .trim();
    }

    #commandSlug(command) {
        return this.#safe(String(command)
            .replace(/^\s*\/+/, '')
            .replace(/\s+/g, '-'));
    }

    #safe(value) {
        const normalized = String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[đĐ]/g, 'd')
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '');
        return normalized || 'gui';
    }
}

module.exports = GuiStructureNormalizer;
