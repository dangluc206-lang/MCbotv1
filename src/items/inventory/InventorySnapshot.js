'use strict';

const { immutableClone } = require('../../shared/utils/object');

class InventorySnapshot {
    constructor({
        botId,
        items = [],
        slotCount = null,
        emptySlotCount = null,
        capturedAt = Date.now(),
        source = 'bot-inventory',
        windowId = null,
        inventoryStart = null,
        inventoryEnd = null
    }) {
        this.botId = botId;
        this.items = immutableClone(items);
        this.slotCount = Number.isInteger(slotCount) ? slotCount : null;
        this.emptySlotCount = Number.isInteger(emptySlotCount) ? emptySlotCount : null;
        this.capturedAt = capturedAt;
        this.source = source;
        this.windowId = windowId;
        this.inventoryStart = Number.isInteger(inventoryStart) ? inventoryStart : null;
        this.inventoryEnd = Number.isInteger(inventoryEnd) ? inventoryEnd : null;
        Object.freeze(this);
    }
}

module.exports = InventorySnapshot;
