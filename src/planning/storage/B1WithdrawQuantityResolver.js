'use strict';

class B1WithdrawQuantityResolver {
    constructor({ numericQuantities = [1, 8, 16, 64, 128, 256, 512] } = {}) {
        this.numericQuantities = Object.freeze([...new Set(numericQuantities
            .map(Number)
            .filter(value => Number.isInteger(value) && value > 0))]
            .sort((a, b) => b - a));
    }

    resolve(requestedAmount, availableQuantities = this.numericQuantities) {
        const requested = Number(requestedAmount);
        if (!Number.isInteger(requested) || requested < 0) {
            throw new RangeError('B1 withdrawal amount must be a non-negative integer.');
        }
        if (requested === 0) return Object.freeze([]);
        const available = [...new Set((availableQuantities || [])
            .map(Number)
            .filter(value => Number.isInteger(value) && value > 0 && this.numericQuantities.includes(value)))]
            .sort((a, b) => b - a);
        if (available.length === 0) return null;

        // Exact unbounded coin change. Store only click counts and the chosen
        // action instead of copying an action array for every subtotal; B1
        // requirements can be large enough for the naive O(amount * path)
        // representation to become a memory/performance problem.
        const unreachable = -1;
        const best = new Int32Array(requested + 1);
        const choice = new Int32Array(requested + 1);
        best.fill(unreachable);
        best[0] = 0;
        for (let total = 1; total <= requested; total += 1) {
            for (const quantity of available) {
                if (quantity > total || best[total - quantity] === unreachable) continue;
                const candidate = best[total - quantity] + 1;
                if (best[total] === unreachable || candidate < best[total]) {
                    best[total] = candidate;
                    choice[total] = quantity;
                }
            }
        }
        if (best[requested] === unreachable) return null;
        const actions = [];
        let remaining = requested;
        while (remaining > 0) {
            const quantity = choice[remaining];
            if (quantity <= 0) return null;
            actions.push(quantity);
            remaining -= quantity;
        }
        return Object.freeze(actions.sort((a, b) => b - a));
    }
}

module.exports = B1WithdrawQuantityResolver;
