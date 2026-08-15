'use strict';

const { immutableClone } = require('../../shared/utils/object');

class PersonalVaultSnapshot {
    constructor({ items = [], totals = {}, slotCount = null, emptySlotCount = null, occupiedSlotCount = null, capturedAt = Date.now() }) {
        this.items = immutableClone(items);
        this.totals = immutableClone(totals);
        const occupied = Number.isInteger(occupiedSlotCount) ? occupiedSlotCount : items.length;
        const slots = Number.isInteger(slotCount) ? slotCount : null;
        const empty = Number.isInteger(emptySlotCount)
            ? emptySlotCount
            : (slots === null ? null : Math.max(0, slots - occupied));
        this.slotCount = slots;
        this.occupiedSlotCount = occupied;
        this.emptySlotCount = empty;
        this.capturedAt = capturedAt;
        Object.freeze(this);
    }

    count(logicalId) {
        return Number(this.totals[logicalId] || 0);
    }
}

module.exports = PersonalVaultSnapshot;
