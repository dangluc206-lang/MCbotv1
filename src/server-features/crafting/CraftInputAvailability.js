'use strict';

/**
 * Generic input-availability policy for the crafting path.
 * Pure math only: thresholds come from the caller/configuration and no tier,
 * target or item name is hard-coded here. Keeping this single implementation
 * means every crafting consumer shares one capacity/backpressure rule.
 */
function personalVaultPressure(snapshot, policy = {}) {
    const minEmptySlots = Math.max(0, Number(policy?.minEmptySlots ?? 3));
    const hardMinEmptySlots = Math.max(0, Math.min(minEmptySlots, Number(policy?.hardMinEmptySlots ?? 1)));
    const emptySlotCount = Number(snapshot?.emptySlotCount);
    const slotCount = Number(snapshot?.slotCount);
    const known = Number.isInteger(emptySlotCount) && emptySlotCount >= 0;
    return Object.freeze({
        known,
        emptySlotCount: known ? emptySlotCount : null,
        slotCount: Number.isInteger(slotCount) && slotCount >= 0 ? slotCount : null,
        minEmptySlots,
        hardMinEmptySlots,
        backpressure: known ? emptySlotCount <= minEmptySlots : false,
        critical: known ? emptySlotCount <= hardMinEmptySlots : false,
        allowNewIntermediates: known ? emptySlotCount > minEmptySlots : true
    });
}

module.exports = Object.freeze({ personalVaultPressure });
