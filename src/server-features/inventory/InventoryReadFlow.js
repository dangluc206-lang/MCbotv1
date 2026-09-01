'use strict';

class InventoryReadFlow {
    constructor({ inventoryReader, config = {} } = {}) {
        if (!inventoryReader) {
            throw new TypeError('InventoryReadFlow inventoryReader is required.');
        }

        this.inventoryReader = inventoryReader;
        this.config = Object.freeze({
            primarySource: config.primarySource || 'auto'
        });
    }

    reconfigure(config = {}) {
        this.config = Object.freeze({
            ...this.config,
            ...(config || {})
        });
        return this;
    }

    readViews(options = {}) {
        if (typeof this.inventoryReader.readViews === 'function') {
            return this.inventoryReader.readViews(options);
        }

        if (typeof this.inventoryReader.readBotInventory === 'function') {
            return [this.inventoryReader.readBotInventory(options)];
        }

        if (typeof this.inventoryReader.read === 'function') {
            return [this.inventoryReader.read(options)];
        }

        throw new TypeError('InventoryReadFlow has no inventory read capability.');
    }

    readPrimary(options = {}) {
        const views = this.readViews(options);

        if (this.config.primarySource !== 'auto') {
            const preferred = views.find(view => view?.source === this.config.primarySource);
            if (preferred) return preferred;
        }

        return views.find(view => view?.source === 'current-window')
            || views.find(view => view?.source === 'bot-inventory')
            || views[0]
            || { items: [], emptySlotCount: 0 };
    }
}

module.exports = InventoryReadFlow;