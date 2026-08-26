'use strict';

const ACTION = Object.freeze({
    NUMERIC: 'NUMERIC',
    STACK: 'STACK',
    FILL_INVENTORY: 'FILL_INVENTORY'
});

class B1WithdrawQuantityResolver {
    constructor({
        numericQuantities = [1, 8, 16, 64, 128, 256, 512],
        maxWithdrawalActions = 64
    } = {}) {
        this.numericQuantities = Object.freeze(this.#numbers(numericQuantities));
        this.maxWithdrawalActions = this.#positiveInteger(maxWithdrawalActions, 64);
    }

    // Backward-compatible numeric API. Unlike the old amount-indexed DP, this
    // is O(number of buttons * bounded backtracking), not O(requestedAmount).
    resolve(requestedAmount, availableQuantities = this.numericQuantities) {
        const requested = this.#requested(requestedAmount);
        if (requested === 0) return Object.freeze([]);
        const available = this.#numbers(availableQuantities)
            .filter(value => this.numericQuantities.includes(value));
        if (available.length === 0) return null;
        const counts = this.#solveFixed(requested, available, Number.MAX_SAFE_INTEGER);
        if (!counts) return null;
        const actions = [];
        for (const [amount, count] of counts) {
            for (let index = 0; index < count; index += 1) actions.push(amount);
        }
        return Object.freeze(actions);
    }

    resolvePlan(requestedAmount, available = {}, {
        stackSize = 64,
        fillInventoryAmount = 0,
        maxWithdrawalActions = this.maxWithdrawalActions
    } = {}) {
        const requested = this.#requested(requestedAmount);
        const limit = this.#positiveInteger(maxWithdrawalActions, this.maxWithdrawalActions);
        if (requested === 0) return Object.freeze({ requestedAmount: 0, actionCount: 0, batches: Object.freeze([]) });

        const normalized = this.#normalizeAvailable(available, stackSize, fillInventoryAmount);
        const candidates = [];
        if (normalized.fillInventory && normalized.fillInventoryAmount === requested) {
            candidates.push({ kind: ACTION.FILL_INVENTORY, amount: requested, slot: normalized.fillInventorySlot ?? null, priority: 3 });
        }
        if (normalized.stack && normalized.stackSize > 0) {
            candidates.push({ kind: ACTION.STACK, amount: normalized.stackSize, slot: normalized.stackSlot ?? null, priority: 2 });
        }
        for (const [amount, slot] of normalized.numeric) {
            candidates.push({ kind: ACTION.NUMERIC, amount, quantity: amount, slot, priority: 1 });
        }

        const unique = this.#dedupeCandidates(candidates);
        if (unique.length === 0) return null;
        const solved = this.#solveCandidates(requested, unique, limit);
        if (!solved) return null;

        const batches = solved.map(({ candidate, count }) => Object.freeze({
            kind: candidate.kind,
            amount: candidate.amount,
            quantity: candidate.kind === ACTION.NUMERIC ? candidate.amount : null,
            count,
            slot: candidate.slot ?? null
        }));
        const actionCount = batches.reduce((sum, batch) => sum + batch.count, 0);
        return Object.freeze({ requestedAmount: requested, actionCount, batches: Object.freeze(batches) });
    }

    static displayAction(batch) {
        if (!batch) return null;
        return batch.kind === ACTION.NUMERIC ? Number(batch.amount) : batch.kind;
    }

    #normalizeAvailable(available, stackSize, fillInventoryAmount) {
        if (Array.isArray(available)) {
            return {
                numeric: this.#numbers(available).map(amount => [amount, null]),
                stack: false,
                stackSize: this.#positiveInteger(stackSize, 64),
                stackSlot: null,
                fillInventory: false,
                fillInventoryAmount: 0,
                fillInventorySlot: null
            };
        }
        const numericEntries = available?.numericSlots instanceof Map
            ? [...available.numericSlots.entries()]
            : Object.entries(available?.numericSlots || {}).map(([amount, slot]) => [Number(amount), slot]);
        const numeric = numericEntries
            .filter(([amount]) => Number.isInteger(Number(amount)) && Number(amount) > 0 && this.numericQuantities.includes(Number(amount)))
            .map(([amount, slot]) => [Number(amount), slot])
            .sort((a, b) => b[0] - a[0]);
        return {
            numeric,
            stack: Boolean(available?.stackSlot !== null && available?.stackSlot !== undefined),
            stackSize: this.#positiveInteger(available?.stackSize ?? stackSize, 64),
            stackSlot: available?.stackSlot ?? null,
            fillInventory: Boolean(available?.fillInventorySlot !== null && available?.fillInventorySlot !== undefined),
            fillInventoryAmount: Math.max(0, Math.floor(Number(available?.fillInventoryAmount ?? fillInventoryAmount) || 0)),
            fillInventorySlot: available?.fillInventorySlot ?? null
        };
    }

    #solveCandidates(requested, candidates, limit) {
        const ordered = [...candidates].sort((a, b) =>
            b.amount - a.amount || b.priority - a.priority || String(a.kind).localeCompare(String(b.kind))
        );
        const greedy = this.#greedyCandidates(requested, ordered, limit);
        if (greedy) return greedy;
        return this.#boundedSearch(requested, ordered, limit);
    }

    #greedyCandidates(requested, candidates, limit) {
        let remaining = requested;
        let used = 0;
        const result = [];
        for (const candidate of candidates) {
            if (candidate.amount <= 0 || candidate.amount > remaining) continue;
            const count = Math.min(Math.floor(remaining / candidate.amount), limit - used);
            if (count <= 0) continue;
            result.push({ candidate, count });
            remaining -= count * candidate.amount;
            used += count;
            if (remaining === 0) return result;
            if (used >= limit) break;
        }
        return null;
    }

    #boundedSearch(requested, candidates, limit) {
        let best = null;
        const suffixGcd = new Array(candidates.length + 1).fill(0);
        for (let index = candidates.length - 1; index >= 0; index -= 1) {
            suffixGcd[index] = this.#gcd(suffixGcd[index + 1], candidates[index].amount);
        }
        const visit = (index, remaining, used, chosen) => {
            if (remaining === 0) {
                if (!best || used < best.used) best = { used, chosen: chosen.map(entry => ({ ...entry })) };
                return;
            }
            if (index >= candidates.length || used >= limit || (best && used >= best.used)) return;
            const gcd = suffixGcd[index];
            if (gcd > 0 && remaining % gcd !== 0) return;
            const candidate = candidates[index];
            const maxByAmount = Math.floor(remaining / candidate.amount);
            const maxCount = Math.min(maxByAmount, limit - used, best ? best.used - used - 1 : Number.MAX_SAFE_INTEGER);
            for (let count = maxCount; count >= 0; count -= 1) {
                if (count > 0) chosen.push({ candidate, count });
                visit(index + 1, remaining - count * candidate.amount, used + count, chosen);
                if (count > 0) chosen.pop();
            }
        };
        visit(0, requested, 0, []);
        return best?.chosen || null;
    }

    #solveFixed(requested, quantities, limit) {
        const candidates = quantities.map(amount => ({ kind: ACTION.NUMERIC, amount, priority: 1 }));
        const solved = this.#solveCandidates(requested, candidates, limit);
        if (!solved) return null;
        return solved.map(({ candidate, count }) => [candidate.amount, count]);
    }

    #dedupeCandidates(candidates) {
        const seen = new Set();
        const output = [];
        for (const candidate of candidates) {
            const key = `${candidate.kind}:${candidate.amount}:${candidate.slot ?? ''}`;
            if (seen.has(key) || !Number.isInteger(candidate.amount) || candidate.amount <= 0) continue;
            seen.add(key);
            output.push(candidate);
        }
        return output;
    }

    #numbers(values) {
        return [...new Set((values || [])
            .map(Number)
            .filter(value => Number.isInteger(value) && value > 0))]
            .sort((a, b) => b - a);
    }

    #requested(value) {
        const requested = Number(value);
        if (!Number.isInteger(requested) || requested < 0) {
            throw new RangeError('B1 withdrawal amount must be a non-negative integer.');
        }
        return requested;
    }

    #positiveInteger(value, fallback) {
        const number = Number(value);
        return Number.isInteger(number) && number > 0 ? number : fallback;
    }

    #gcd(a, b) {
        let left = Math.abs(Number(a) || 0);
        let right = Math.abs(Number(b) || 0);
        while (right) [left, right] = [right, left % right];
        return left;
    }
}

B1WithdrawQuantityResolver.ACTION = ACTION;
module.exports = B1WithdrawQuantityResolver;
