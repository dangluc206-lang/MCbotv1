'use strict';

function slotsOf(window) {
    return Array.isArray(window?.slots) ? window.slots : [];
}

function containerEnd(window) {
    const slots = slotsOf(window);
    const inventoryStart = Number(window?.inventoryStart);
    if (Number.isInteger(inventoryStart) && inventoryStart >= 0) {
        return Math.min(inventoryStart, slots.length);
    }
    return slots.length;
}

function isContainerSlot(window, slot) {
    return Number.isInteger(slot) && slot >= 0 && slot < containerEnd(window);
}

function findContainerSlot(window, predicate) {
    if (typeof predicate !== 'function') throw new TypeError('predicate must be a function.');
    const slots = slotsOf(window);
    const end = containerEnd(window);
    for (let slot = 0; slot < end; slot += 1) {
        const item = slots[slot];
        if (predicate(item, slot)) return slot;
    }
    return -1;
}

module.exports = { slotsOf, containerEnd, isContainerSlot, findContainerSlot };
