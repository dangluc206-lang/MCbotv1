'use strict';

class B5InventoryReadFlow {
    constructor({ inventoryReader }) {
        if (!inventoryReader) throw new TypeError('B5InventoryReadFlow inventoryReader is required.');
        this.inventoryReader = inventoryReader;
    }

    readViews() {
        if (typeof this.inventoryReader.readViews === 'function') return this.inventoryReader.readViews();
        if (typeof this.inventoryReader.readBotInventory === 'function') return [this.inventoryReader.readBotInventory()];
        if (typeof this.inventoryReader.read === 'function') return [this.inventoryReader.read()];
        throw new TypeError('B5InventoryReadFlow has no inventory read capability.');
    }

    readPrimary() {
        const views = this.readViews();
        return views.find(view => view?.source === 'current-window')
            || views.find(view => view?.source === 'bot-inventory')
            || views[0]
            || { items: [], emptySlotCount: 0 };
    }
}

module.exports = B5InventoryReadFlow;
