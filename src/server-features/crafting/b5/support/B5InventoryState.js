'use strict';

const Timeout = require('../../../../shared/time/Timeout');

class B5InventoryState {
    constructor({ inventoryReader, inventoryCounter, config }) {
        this.inventoryReader = inventoryReader;
        this.inventoryCounter = inventoryCounter;
        this.config = config;
    }

    count(logicalId) {
        const views = typeof this.inventoryReader.readViews === 'function'
            ? this.inventoryReader.readViews()
            : (typeof this.inventoryReader.readBotInventory === 'function'
                ? [this.inventoryReader.readBotInventory()]
                : [this.inventoryReader.read()]);
        let best = 0;
        for (const snapshot of views || []) {
            if (!snapshot) continue;
            best = Math.max(best, this.inventoryCounter.count(snapshot, logicalId));
        }
        return best;
    }

    countFromSource(logicalId, source = 'bot-inventory') {
        const target = String(source || '').trim();
        const views = typeof this.inventoryReader.readViews === 'function'
            ? this.inventoryReader.readViews()
            : (typeof this.inventoryReader.readBotInventory === 'function'
                ? [{ source: 'bot-inventory', ...this.inventoryReader.readBotInventory() }]
                : [this.inventoryReader.read()]);
        let total = 0;
        let found = false;
        for (const view of views || []) {
            if (!view || (target && String(view.source || '').trim() !== target)) continue;
            found = true;
            total = Math.max(total, Number(this.inventoryCounter.count(view, logicalId) || 0));
        }
        return found ? total : 0;
    }

    snapshot() {
        if (typeof this.inventoryReader.readBotInventory === 'function') return this.inventoryReader.readBotInventory();
        const views = typeof this.inventoryReader.readViews === 'function'
            ? this.inventoryReader.readViews()
            : [this.inventoryReader.read()];
        return views.find(view => view?.source === 'bot-inventory') || views[0] || { items: [], emptySlotCount: 0 };
    }

    spaceSnapshot() {
        const views = typeof this.inventoryReader.readViews === 'function'
            ? this.inventoryReader.readViews()
            : [this.snapshot()];
        let best = null;
        for (const view of views || []) {
            if (!view) continue;
            if (!best || Number(view.emptySlotCount || 0) > Number(best.emptySlotCount || 0)) best = view;
        }
        return best || this.snapshot();
    }

    async waitForFreeSlots(minFreeSlots, cancellationToken, timeoutMs = 1400) {
        const deadline = Date.now() + Math.max(100, Number(timeoutMs) || 1400);
        let best = this.spaceSnapshot();
        while (Date.now() < deadline && Number(best.emptySlotCount || 0) < minFreeSlots) {
            cancellationToken?.throwIfCancelled?.();
            await Timeout.delay(Math.min(75, Math.max(1, deadline - Date.now())), { cancellationToken });
            const current = this.spaceSnapshot();
            if (Number(current.emptySlotCount || 0) > Number(best.emptySlotCount || 0)) best = current;
        }
        return best;
    }

    async waitForIncrease(logicalId, beforeCount, cancellationToken) {
        const settleTimeoutMs = Math.max(0, Number(this.config?.pvInventorySettleTimeoutMs ?? 1600));
        const settlePollMs = Math.max(10, Number(this.config?.pvInventorySettlePollMs ?? 50));
        let best = this.count(logicalId);
        if (best > beforeCount || settleTimeoutMs <= 0) return best;

        const deadline = Date.now() + settleTimeoutMs;
        while (Date.now() < deadline) {
            cancellationToken?.throwIfCancelled?.();
            await Timeout.delay(Math.min(settlePollMs, Math.max(1, deadline - Date.now())), { cancellationToken });
            best = Math.max(best, this.count(logicalId));
            if (best > beforeCount) break;
        }
        return best;
    }

    async waitForSettledCount(logicalId, minimumCount, cancellationToken, options = {}) {
        const timeoutMs = Math.max(100, Number(options.timeoutMs ?? this.config?.stageSettlementTimeoutMs ?? this.config?.b2B3SettlementBarrierTimeoutMs ?? 1800));
        const pollMs = Math.max(10, Number(options.pollMs ?? this.config?.stageSettlementPollMs ?? this.config?.b2B3SettlementBarrierPollMs ?? 50));
        const quietMs = Math.max(0, Number(options.quietMs ?? this.config?.stageSettlementQuietMs ?? this.config?.b2B3SettlementBarrierQuietMs ?? 100));
        const requiredStablePasses = Math.max(1, Number(options.stablePasses ?? this.config?.stageSettlementStablePasses ?? this.config?.b2B3SettlementBarrierStablePasses ?? 2));
        const target = Math.max(0, Number(minimumCount) || 0);
        const startedAt = Date.now();
        const deadline = startedAt + timeoutMs;

        const readCount = typeof options.source === 'string' && typeof this.countFromSource === 'function'
            ? () => this.countFromSource(logicalId, options.source)
            : () => this.count(logicalId);
        let current = readCount();
        let lastObserved = current;
        let stablePasses = 1;
        let lastChangeAt = startedAt;

        while (Date.now() <= deadline) {
            cancellationToken?.throwIfCancelled?.();
            current = readCount();

            if (current !== lastObserved) {
                lastObserved = current;
                stablePasses = 1;
                lastChangeAt = Date.now();
            } else {
                stablePasses += 1;
            }

            const quietForMs = Math.max(0, Date.now() - lastChangeAt);
            if (current >= target && stablePasses >= requiredStablePasses && quietForMs >= quietMs) {
                return {
                    settled: true,
                    timedOut: false,
                    logicalId,
                    minimumCount: target,
                    count: current,
                    stablePasses,
                    quietForMs,
                    elapsedMs: Date.now() - startedAt
                };
            }

            const remaining = deadline - Date.now();
            if (remaining <= 0) break;
            await Timeout.delay(Math.min(pollMs, remaining), { cancellationToken });
        }

        return {
            settled: false,
            timedOut: true,
            logicalId,
            minimumCount: target,
            count: current,
            stablePasses,
            quietForMs: Math.max(0, Date.now() - lastChangeAt),
            elapsedMs: Date.now() - startedAt
        };
    }

    async waitForAtMost(logicalId, maximum, cancellationToken) {
        const settleTimeoutMs = Math.max(0, Number(this.config?.pvInventorySettleTimeoutMs ?? 1600));
        const settlePollMs = Math.max(10, Number(this.config?.pvInventorySettlePollMs ?? 50));
        let current = this.count(logicalId);
        if (current <= maximum || settleTimeoutMs <= 0) return current;

        const deadline = Date.now() + settleTimeoutMs;
        while (Date.now() < deadline) {
            cancellationToken?.throwIfCancelled?.();
            await Timeout.delay(Math.min(settlePollMs, Math.max(1, deadline - Date.now())), { cancellationToken });
            current = this.count(logicalId);
            if (current <= maximum) break;
        }
        return current;
    }

    maxCraftable(inputs) {
        const entries = Object.entries(inputs || {}).filter(([, amount]) => Number(amount) > 0);
        if (entries.length === 0) return Number.MAX_SAFE_INTEGER;
        let max = Number.MAX_SAFE_INTEGER;
        for (const [logicalId, perCraft] of entries) {
            max = Math.min(max, Math.floor(this.count(logicalId) / Number(perCraft)));
        }
        return Math.max(0, max);
    }

    allEnabled(key) {
        const policy = this.config?.quantityOptimization || {};
        return policy.enabled !== false && policy[key] === true;
    }

    allowsNewIntermediates(data) {
        const pressure = data?.personalVaultPressure || null;
        return pressure?.allowNewIntermediates !== false && pressure?.critical !== true;
    }

    vaultCanAccept(snapshot, logicalId, amount = 1) {
        if (!snapshot || snapshot.emptySlotCount === null || snapshot.emptySlotCount === undefined) return true;
        if (Number(snapshot.emptySlotCount) > 0) return true;
        let remaining = Math.max(1, Number(amount || 1));
        for (const item of snapshot.items || []) {
            if (item?.logicalId !== logicalId) continue;
            const maxStackSize = Number(item.maxStackSize);
            if (!Number.isInteger(maxStackSize) || maxStackSize <= 0) continue;
            remaining -= Math.max(0, maxStackSize - Math.max(0, Number(item.count || 0)));
            if (remaining <= 0) return true;
        }
        return false;
    }

    actualCrafts(crafted, requestedQuantity) {
        const actual = Number(crafted?.actualCrafts || 0);
        if (Number.isInteger(actual) && actual > 0) return actual;
        if (requestedQuantity === 1 || requestedQuantity === 64) return requestedQuantity;
        return 0;
    }
}

module.exports = B5InventoryState;
