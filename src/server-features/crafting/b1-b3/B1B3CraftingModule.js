'use strict';

class B1B3CraftingModule {
    constructor({
        readService,
        craftPlanningService,
        craftingVerificationService,
        inputCoordinator,
        reserveCoordinator
    } = {}) {
        if (!readService) {
            throw new TypeError('B1B3CraftingModule readService is required.');
        }
        if (!craftPlanningService?.plan) {
            throw new TypeError('B1B3CraftingModule craftPlanningService.plan is required.');
        }
        if (!craftingVerificationService) {
            throw new TypeError('B1B3CraftingModule craftingVerificationService is required.');
        }
        if (!inputCoordinator?.acquire
            || !inputCoordinator?.prepareBase
            || !inputCoordinator?.finalizeBase) {
            throw new TypeError('B1B3CraftingModule inputCoordinator is incomplete.');
        }
        if (!reserveCoordinator?.prepare) {
            throw new TypeError('B1B3CraftingModule reserveCoordinator.prepare is required.');
        }

        Object.assign(this, {
            readService,
            craftPlanningService,
            craftingVerificationService,
            inputCoordinator,
            reserveCoordinator
        });
    }

    reconfigure(config = {}) {
        this.inputCoordinator.reconfigure?.(config);
        this.reserveCoordinator.reconfigure?.(config);
        this.craftPlanningService.reconfigure?.(config);
        return this;
    }

    plan(targetId, amount, available = {}) {
        return this.craftPlanningService.plan(
            targetId,
            amount,
            available
        );
    }

    async inspect(options = {}) {
        const inventory = await Promise.resolve(
            this.readService.readInventory()
        );
        const pv2 = await this.readService.readPv2(options);
        const kho = await this.readService.readKho(options);
        return Object.freeze({ inventory, pv2, kho });
    }

    async prepare(chain, context, options = {}) {
        const prepared = await this.inputCoordinator.prepareBase(
            chain,
            context,
            {
                requiredRaw: options.requiredRawForStart,
                options: {
                    decompressionPolicy: options.decompressionPolicy,
                    decompressionMaxRatioOverride:
                        options.decompressionMaxUsageRatio,
                    requireKnownCapacityOverride:
                        options.requireKnownCapacity
                }
            }
        );
        if (prepared?.success === false) {
            return {
                ready: false,
                reason: 'b1-prepare-failed',
                prepared
            };
        }
        if (prepared?.data?.ready === false) {
            return {
                ready: false,
                reason: prepared.data.reason || 'base-form-unavailable',
                prepared: prepared.data
            };
        }

        const plannedB2 = Math.max(
            0,
            Number(options.b2Remaining ?? chain?.b2Crafts ?? 0)
        );
        const reserveChain = {
            ...chain,
            b2Crafts: plannedB2,
            b3Crafts: Number(options.b3Remaining ?? chain?.b3Crafts ?? 0),
            rawNeededFromStorage: Number(
                options.requiredRawForStart
                ?? chain?.rawNeededFromStorage
                ?? 0
            ),
            partialReservePass:
                options.partialReservePass === true
                || options.useAllForB2 === true
                || plannedB2 < Number(chain?.b2Crafts || 0),
            useAllForB2: options.useAllForB2 === true
        };
        const available = Number(prepared?.data?.available);
        if (Number.isFinite(available) && available >= 0) {
            reserveChain.reconciliationBaseline = {
                inputs: {
                    [chain.baseId]: {
                        source: 'storage',
                        count: available
                    }
                }
            };
        }

        const acquired = await this.inputCoordinator.acquire(
            chain,
            context,
            {
                b2Remaining: plannedB2,
                minFreeForB3All:
                    Number(options.minFreeForB3All || 1),
                allChains: options.allChains || []
            }
        );
        return Object.freeze({
            ...acquired,
            prepared: prepared?.data || null,
            reserveChain
        });
    }

    async execute(reserveChain, context, options = {}) {
        return this.reserveCoordinator.prepare(
            reserveChain,
            context,
            {
                deferIntermediateDeposit:
                    options.deferIntermediateDeposit !== false,
                allChains: options.allChains || []
            }
        );
    }

    async finish(chain, context) {
        const returned = await this.inputCoordinator.returnToStorage(
            chain,
            context
        );
        const finalized = await this.inputCoordinator.finalizeBase(
            chain,
            context
        );
        return {
            returned: returned?.data || returned,
            finalized: finalized?.data || finalized
        };
    }

}

module.exports = B1B3CraftingModule;
