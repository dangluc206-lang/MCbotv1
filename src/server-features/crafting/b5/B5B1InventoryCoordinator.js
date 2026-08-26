'use strict';

const FlowError = require('../../../shared/errors/FlowError');

class B5B1InventoryCoordinator {
    constructor({
        storageFlow,
        b2Input,
        inventoryState,
        recipeRegistry,
        config,
        logger = null,
        runStep,
        childOptions,
        ensureFreeIntermediateSlots
    }) {
        Object.assign(this, {
            storageFlow, b2Input, inventoryState, recipeRegistry, config, logger,
            runStep, childOptions, ensureFreeIntermediateSlots
        });
    }

    reconfigure(config = {}) {
        this.config = config || {};
    }

    async acquire(chain, context, options = {}) {
        this.#assertContract(chain, context);
        const request = this.#request(chain, options);
        if (this.b2Input.source === 'storage') {
            if (typeof this.storageFlow?.prepareBase !== 'function') {
                return {
                    ready: request.plannedCrafts > 0, reason: null, source: 'storage',
                    baseId: chain.baseId, b2Id: chain.b2Id, basePerB2: request.basePerB2,
                    plannedCrafts: request.plannedCrafts, available: request.usefulTotal,
                    craftable: request.plannedCrafts, transfer: null, reserveSlots: request.reserveSlots,
                    maxAmount: 0
                };
            }

            const prepared = await this.runStep(context, {
                subsystem: 'b5', step: 'prepare-b1-for-b2',
                action: 'refresh /kho and prepare only the B1 type currently being crafted', resource: chain.baseId,
                details: {
                    b2Id: chain.b2Id,
                    b2RecipeId: chain.b2RecipeId,
                    requiredBase: request.basePerB2,
                    b2Remaining: request.plannedCrafts,
                    source: 'storage'
                }
            }, () => this.storageFlow.prepareBase(chain.baseId, request.basePerB2, this.childOptions(context, {
                outputId: chain.b2Id,
                minimumFreeSlots: request.reserveSlots
            })), { acceptFailedResult: true });

            if (prepared?.success === false) {
                return {
                    ready: false,
                    reason: prepared.message || 'b1-prepare-failed',
                    source: 'storage',
                    baseId: chain.baseId,
                    b2Id: chain.b2Id,
                    basePerB2: request.basePerB2,
                    plannedCrafts: request.plannedCrafts,
                    available: 0,
                    craftable: 0,
                    transfer: null,
                    reserveSlots: request.reserveSlots,
                    maxAmount: 0,
                    preparation: prepared.meta || null
                };
            }

            const data = prepared?.data || {};
            const available = Math.max(0, Number(data.available || 0));
            const ready = data.ready !== false && available >= request.basePerB2;
            return {
                ready,
                reason: ready ? null : (data.reason || 'b1-storage-not-ready'),
                source: 'storage',
                baseId: chain.baseId,
                b2Id: chain.b2Id,
                basePerB2: request.basePerB2,
                plannedCrafts: request.plannedCrafts,
                available,
                craftable: Math.floor(available / request.basePerB2),
                transfer: null,
                reserveSlots: request.reserveSlots,
                maxAmount: 0,
                preparation: data
            };
        }
        let state = this.#state(chain, request.reserveSlots);

        if (this.#needsStaleRebalance(state, request)) {
            state = await this.#rebalanceStale(chain, context, request, state);
        }
        if (state.available >= request.basePerB2 && state.emptySlots < request.reserveSlots) {
            return this.#notReady(chain, request, state, 'b1-inventory-headroom-not-ready');
        }
        if (state.available < request.basePerB2 && state.emptySlots <= request.reserveSlots) {
            const freed = await this.ensureFreeIntermediateSlots(chain, context, request.reserveSlots + 1, {
                reason: 'reserve one B1 transfer slot before B2',
                preserveAtLeastB2: chain.b3InputPerCraft,
                preferCurrentB2: false,
                allChains: options.allChains || []
            });
            state = this.#state(chain, request.reserveSlots, freed?.snapshot || null);
        }

        const acquisition = await this.#acquireMissing(chain, context, request, state);
        state = this.#state(chain, request.reserveSlots);
        const craftable = Math.floor(state.available / request.basePerB2);
        return {
            ready: craftable > 0,
            reason: craftable > 0 ? null : 'b1-transfer-not-ready',
            baseId: chain.baseId,
            b2Id: chain.b2Id,
            basePerB2: request.basePerB2,
            plannedCrafts: request.plannedCrafts,
            available: state.available,
            craftable,
            transfer: acquisition.transfer,
            reserveSlots: request.reserveSlots,
            maxAmount: acquisition.maxAmount
        };
    }

    async returnToStorage(chain, context) {
        if (this.b2Input?.source === 'storage') {
            return { baseId: chain.baseId, before: 0, returned: 0, remaining: 0, skipped: true, source: 'storage' };
        }
        this.#assertReturnCapability(chain, context);
        const before = this.inventoryState.count(chain.baseId);
        if (before <= 0) {
            return { baseId: chain.baseId, before: 0, returned: 0, remaining: 0, skipped: true };
        }
        const returned = await this.#returnAll(chain, context, 'return-b1-after-reserve');
        const remaining = this.inventoryState.count(chain.baseId);
        if (remaining > 0) {
            throw new FlowError(`B1 return to /kho left ${remaining} ${chain.baseId} in inventory.`, {
                code: 'B5_B1_RETURN_INCOMPLETE', subsystem: 'b5', step: 'return-b1-after-reserve',
                action: 'verify B1 player-inventory section after /kho deposit', resource: chain.baseId,
                retryable: true, details: { before, returned, remaining }, trace: context.trace
            });
        }
        return { baseId: chain.baseId, before, returned, remaining, skipped: false };
    }

    async compactAfterB3(chain, context) {
        if (this.b2Input?.source !== 'storage') {
            return { baseId: chain.baseId, skipped: true, source: this.b2Input?.source || null };
        }
        if (typeof this.storageFlow?.finalizeBase !== 'function') {
            return { baseId: chain.baseId, skipped: true, reason: 'storage-finalize-unavailable' };
        }
        const result = await this.runStep(context, {
            subsystem: 'b5', step: 'compact-b1-after-b3',
            action: 'after enough B2 for B3, close the current B1 transaction and compact only that B1 type', resource: chain.baseId,
            details: { b2Id: chain.b2Id, b3Id: chain.b3Id }
        }, () => this.storageFlow.finalizeBase(chain.baseId, this.childOptions(context)), { acceptFailedResult: true });
        if (result?.success === false) return result;
        const data = result?.data || {};
        if (data.ready === false) {
            return {
                success: false,
                status: 'NOT_READY',
                message: data.reason || 'b1-compaction-after-b3-not-ready',
                data
            };
        }
        return { baseId: chain.baseId, skipped: data.skipped === true, ...data };
    }

    #assertContract(chain, context) {
        if (typeof this.b2Input?.acquire !== 'function' || !['inventory', 'storage'].includes(this.b2Input?.source)) {
            throw new FlowError('B5 requires a canonical B2 input acquisition flow.', {
                code: 'B5_B1_INPUT_FLOW_UNAVAILABLE', subsystem: 'b5',
                step: 'acquire-b1-for-b2', action: 'require B2InputAcquisitionFlow',
                resource: chain.baseId, retryable: false, trace: context.trace
            });
        }
        if (this.config?.b2InputSource === 'inventory' && this.b2Input.source !== 'inventory') {
            throw new FlowError('B5 V5 requires canonical B1 inventory withdrawal before B2.', {
                code: 'B5_B1_INVENTORY_TRANSFER_UNAVAILABLE', subsystem: 'b5',
                step: 'acquire-b1-for-b2', action: 'require B2InputAcquisitionFlow source=inventory',
                resource: chain.baseId, retryable: false, trace: context.trace
            });
        }
        if (this.b2Input.source === 'inventory') this.#assertReturnCapability(chain, context);
    }

    #assertReturnCapability(chain, context) {
        if (typeof this.storageFlow?.returnBaseInventory === 'function') return;
        throw new FlowError('B5 V5 requires verified B1 return through the storage flow.', {
            code: 'B5_B1_RETURN_UNAVAILABLE', subsystem: 'b5', step: 'return-b1-after-reserve',
            action: 'return B1 remainder to /kho', resource: chain.baseId,
            retryable: false, trace: context.trace
        });
    }

    #request(chain, { b2Remaining, minFreeForB3All = 1 } = {}) {
        const recipe = this.recipeRegistry.require(chain.b2RecipeId);
        const basePerB2 = Math.max(1, Number(recipe?.inputs?.[chain.baseId] || 0));
        const plannedCrafts = Math.max(1, Math.floor(Number(b2Remaining || 1)));
        const reserveSlots = Math.max(
            1,
            Math.floor(Number(minFreeForB3All || 1)),
            Math.max(0, Math.floor(Number(this.config?.inventorySafetyEmptySlots || 0)))
        );
        return { basePerB2, plannedCrafts, reserveSlots, usefulTotal: plannedCrafts * basePerB2 };
    }

    #state(chain, reserveSlots, snapshot = null) {
        const space = snapshot || this.inventoryState.spaceSnapshot();
        return {
            available: this.inventoryState.count(chain.baseId),
            emptySlots: Number(space?.emptySlotCount || 0),
            reserveSlots,
            space
        };
    }

    #needsStaleRebalance(state, request) {
        return state.available >= request.basePerB2 && state.emptySlots < request.reserveSlots;
    }

    async #rebalanceStale(chain, context, request, state) {
        const before = state.available;
        await this.#returnAll(chain, context, 'rebalance-stale-b1-before-b2');
        const after = this.#state(chain, request.reserveSlots);
        this.logger?.info?.('B5 B1 STALE INVENTORY REBALANCED', {
            operation: 'B5Automation', step: 'rebalance-stale-b1-before-b2', phase: 'OK',
            resource: chain.baseId, before, after: after.available,
            returned: Math.max(0, before - after.available),
            emptySlotCount: after.emptySlots, reserveSlots: request.reserveSlots
        });
        return after;
    }

    async #acquireMissing(chain, context, request, state) {
        const freeStackSlots = Math.max(0, state.emptySlots - request.reserveSlots);
        const conservativeAddCapacity = freeStackSlots * 64;
        const maxAmount = Math.max(0, Math.min(
            Math.max(0, request.usefulTotal - state.available),
            conservativeAddCapacity
        ));
        if (maxAmount <= 0) return { transfer: null, maxAmount };

        const targetAmount = state.available + maxAmount;
        const result = await this.runStep(context, {
            subsystem: 'b5', step: 'acquire-b1-for-b2',
            action: 'withdraw prepared B1 into inventory before B2', resource: chain.baseId,
            details: {
                b2Id: chain.b2Id, b2RecipeId: chain.b2RecipeId,
                b2Remaining: request.plannedCrafts, basePerB2: request.basePerB2,
                before: state.available, targetAmount, maxAmount, reserveSlots: request.reserveSlots
            }
        }, () => this.b2Input.acquire(chain.baseId, targetAmount, this.childOptions(context, {
            outputId: chain.b2Id,
            expectedOutputAmount: Math.max(1, Math.min(request.plannedCrafts, 64)),
            minimumFreeSlots: request.reserveSlots
        })));
        return { transfer: result?.data || null, maxAmount };
    }

    async #returnAll(chain, context, step) {
        const result = await this.runStep(context, {
            subsystem: 'b5', step,
            action: 'return B1 inventory to /kho through storage transaction', resource: chain.baseId
        }, () => this.storageFlow.returnBaseInventory(chain.baseId, this.childOptions(context)));
        const data = result?.data || {};
        if (data.ready === false) {
            throw new FlowError(`B1 return is not ready for ${chain.baseId}.`, {
                code: 'B5_B1_RETURN_NOT_READY', subsystem: 'b5', step,
                action: 'return B1 inventory to /kho', resource: chain.baseId,
                retryable: true, details: data, trace: context.trace
            });
        }
        return Math.max(0, Number(data.moved ?? data.transfer?.moved ?? 0));
    }

    #notReady(chain, request, state, reason) {
        return {
            ready: false, reason,
            baseId: chain.baseId, b2Id: chain.b2Id,
            basePerB2: request.basePerB2, plannedCrafts: request.plannedCrafts,
            available: state.available,
            craftable: Math.floor(state.available / request.basePerB2),
            reserveSlots: request.reserveSlots,
            emptySlotCount: state.emptySlots
        };
    }
}

module.exports = B5B1InventoryCoordinator;
