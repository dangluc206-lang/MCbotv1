'use strict';

const { findContainerSlot, isContainerSlot } = require('../ContainerSlotRange');

class SlotResolver {
    constructor({ slotRegistry, itemResolver }) {
        Object.assign(this, { slotRegistry, itemResolver });
    }

    resolve(window, { guiId, key, itemId, context = 'gui' }) {
        const configured = this.slotRegistry.get(guiId, key);
        if (configured !== null && isContainerSlot(window, configured)) return configured;
        if (itemId) {
            return findContainerSlot(window, item => item && this.itemResolver.matches(item, itemId, context).matched);
        }
        return -1;
    }
}

module.exports = SlotResolver;
