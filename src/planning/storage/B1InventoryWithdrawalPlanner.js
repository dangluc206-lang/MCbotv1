'use strict';

class B1InventoryWithdrawalPlanner {
    compile({
        requestedAmount,
        inventoryCount = 0,
        emptySlots = 0,
        inputMergeCapacity = 0,
        outputAmount = 0,
        outputMergeCapacity = 0,
        inputStackSize = 64,
        outputStackSize = 64,
        minimumFreeSlots = 1
    } = {}) {
        const requested = this.#integer(requestedAmount);
        const current = this.#integer(inventoryCount);
        const needed = Math.max(0, requested - current);
        const free = this.#integer(emptySlots);
        const inputMerge = this.#integer(inputMergeCapacity);
        const output = this.#integer(outputAmount);
        const outputMerge = this.#integer(outputMergeCapacity);
        const inputStack = Math.max(1, this.#integer(inputStackSize) || 64);
        const outputStack = Math.max(1, this.#integer(outputStackSize) || 64);
        const configuredFloor = this.#integer(minimumFreeSlots);
        const outputSlots = Math.ceil(Math.max(0, output - outputMerge) / outputStack);
        const reservedEmptySlots = Math.max(configuredFloor, outputSlots);
        const usableEmptySlots = Math.max(0, free - reservedEmptySlots);
        const safeAdditionalCapacity = inputMerge + usableEmptySlots * inputStack;
        const safe = needed <= safeAdditionalCapacity;
        return Object.freeze({
            requestedAmount: requested,
            inventoryCount: current,
            needed,
            emptySlots: free,
            inputMergeCapacity: inputMerge,
            outputAmount: output,
            outputMergeCapacity: outputMerge,
            outputSlots,
            reservedEmptySlots,
            usableEmptySlots,
            safeAdditionalCapacity,
            safe,
            reason: safe ? null : 'inventory-capacity-reserved-for-b2-output'
        });
    }

    #integer(value) {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
    }
}

module.exports = B1InventoryWithdrawalPlanner;
