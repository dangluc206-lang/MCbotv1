'use strict';

const FlowError = require('../../../shared/errors/FlowError');

class B1B3ReserveCoordinator {
    constructor({
        personalVault,
        personalVaultStorage,
        inputCoordinator,
        inventoryState,
        inventoryCounter,
        crafting,
        craftingVerificationService,
        recipeRegistry,
        config = {},
        logger = null,
        runStep,
        childOptions,
        quantityTrace = () => {}
    } = {}) {
        if (!personalVault?.withdraw) {
            throw new TypeError('B1B3ReserveCoordinator personalVault.withdraw is required.');
        }
        if (!personalVaultStorage?.deposit) {
            throw new TypeError('B1B3ReserveCoordinator personalVaultStorage.deposit is required.');
        }
        if (!inputCoordinator?.acquire) {
            throw new TypeError('B1B3ReserveCoordinator inputCoordinator.acquire is required.');
        }
        if (!inventoryState?.count || !inventoryState?.spaceSnapshot) {
            throw new TypeError('B1B3ReserveCoordinator inventoryState is required.');
        }
        if (!inventoryCounter?.count) {
            throw new TypeError('B1B3ReserveCoordinator inventoryCounter.count is required.');
        }
        if (!crafting?.craft) {
            throw new TypeError('B1B3ReserveCoordinator crafting.craft is required.');
        }
        if (!craftingVerificationService) {
            throw new TypeError('B1B3ReserveCoordinator craftingVerificationService is required.');
        }

        Object.assign(this, {
            personalVault,
            personalVaultStorage,
            inputCoordinator,
            inventoryState,
            inventoryCounter,
            crafting,
            verification: craftingVerificationService,
            recipeRegistry,
            config,
            logger,
            runStep,
            childOptions,
            quantityTrace
        });
    }

    reconfigure(config = {}) {
        this.config = config || {};
        return this;
    }

    async prepare(chain, context, {
        deferIntermediateDeposit = false,
        allChains = []
    } = {}) {
        const state = {
            b2Remaining: Math.max(0, Number(chain?.b2Crafts || 0)),
            b3Remaining: Math.max(0, Number(chain?.b3Crafts || 0)),
            vaultB2Remaining: Math.max(0, Number(chain?.vaultB2 || 0)),
            deferIntermediateDeposit,
            allChains,
            guard: 0
        };

        while (state.b2Remaining > 0 || state.b3Remaining > 0) {
            context.cancellation.token.throwIfCancelled();
            this.#guard(state, chain, context);

            if (state.b3Remaining > 0
                && this.#count(chain.b2Id) >= Math.max(1, Number(chain.b3InputPerCraft || 1))) {
                const crafted = await this.#craftB3(chain, state, context);
                if (crafted) continue;
            }

            if (state.b3Remaining > 0 && state.vaultB2Remaining > 0) {
                const gained = await this.#withdrawOwnedB2(chain, state, context);
                if (gained > 0) continue;
            }

            if (state.b2Remaining > 0) {
                const crafted = await this.#craftB2(chain, state, context);
                if (crafted) continue;
            }

            const freed = await this.#ensureFreeSlot(chain, context);
            if (freed) continue;

            if (state.b3Remaining > 0) {
                return {
                    b2Id: chain.b2Id,
                    b3Id: chain.b3Id,
                    deferred: deferIntermediateDeposit,
                    waitingForMaterial: true,
                    reason: 'b1-b3-input-or-headroom-not-ready'
                };
            }

            break;
        }

        if (!deferIntermediateDeposit) {
            await this.#depositReserve(chain, context);
        }

        return {
            b2Id: chain.b2Id,
            b3Id: chain.b3Id,
            deferred: deferIntermediateDeposit
        };
    }

    #count(id) {
        return this.inventoryState.count(id);
    }

    #snapshot() {
        return this.inventoryState.snapshot();
    }

    #guard(state, chain, context) {
        state.guard += 1;
        if (state.guard <= 512) return;
        throw new FlowError(
            `B1-B3 reserve chain exceeded safety iteration limit for ${chain.baseId}.`,
            {
                code: 'CRAFT_B1_B3_RESERVE_LOOP_GUARD',
                subsystem: 'crafting',
                step: 'reserve-b1-b3-chain',
                action: 'optimize B2/B3 chain',
                resource: chain.baseId,
                retryable: false,
                details: {
                    b2Remaining: state.b2Remaining,
                    b3Remaining: state.b3Remaining,
                    vaultB2Remaining: state.vaultB2Remaining
                },
                trace: context.trace
            }
        );
    }

    async #withdrawOwnedB2(chain, state, context) {
        const snapshot = this.#snapshot();
        const b2Count = this.inventoryCounter.count(snapshot, chain.b2Id);
        const inputPerCraft = Math.max(1, Number(chain.b3InputPerCraft || 1));
        const needed = Math.max(0, state.b3Remaining * inputPerCraft - b2Count);
        if (needed <= 0 || state.vaultB2Remaining <= 0) return 0;

        const freeSlots = Math.max(
            0,
            Number(snapshot?.emptySlotCount || 0)
                - Math.max(1, Number(this.config?.b3AllMinEmptySlots || 1))
        );
        if (freeSlots <= 0) return 0;

        const maxStacks = Math.max(
            1,
            Math.min(
                freeSlots,
                Math.ceil(
                    Math.min(state.vaultB2Remaining, needed) / 64
                )
            )
        );

        const before = b2Count;
        const result = await this.runStep(context, {
            subsystem: 'crafting',
            step: 'withdraw-b2-for-b3',
            action: 'withdraw B2 from /pv 2 for B3 reserve',
            resource: chain.b2Id,
            details: { before, needed, maxStacks }
        }, () => this.personalVault.withdraw(
            chain.b2Id,
            this.childOptions(context, { maxStacks })
        ));

        const after = await this.inventoryState.waitForIncrease(
            chain.b2Id,
            before,
            context.cancellation.token
        );
        const gained = Math.max(0, Number(after) - before);
        if (gained <= 0) return 0;

        state.vaultB2Remaining = Math.max(
            0,
            state.vaultB2Remaining - gained
        );
        return gained;
    }

    async #craftB2(chain, state, context) {
        const acquired = await this.inputCoordinator.acquire(
            chain,
            context,
            {
                b2Remaining: state.b2Remaining,
                minFreeForB3All: Math.max(
                    1,
                    Number(this.config?.b3AllMinEmptySlots || 1)
                ),
                allChains: state.allChains
            }
        );
        if (!acquired.ready) return false;

        const recipe = this.recipeRegistry.require(chain.b2RecipeId);
        const inventory = this.#snapshot();
        const maxCraftable = this.#maxCraftable(recipe.inputs || {});
        if (maxCraftable <= 0) return false;

        const quantity = state.b2Remaining >= 64 && maxCraftable >= 64
            ? 64
            : (chain.useAllForB2 === true && maxCraftable <= state.b2Remaining
                ? 'ALL'
                : 1);

        this.quantityTrace('CRAFT B1-B3 QUANTITY DECISION', {
            step: 'craft-b2',
            resource: chain.b2Id,
            recipeId: chain.b2RecipeId,
            quantity,
            reason: quantity === 'ALL'
                ? 'b2-all-within-current-plan'
                : (quantity === 64 ? 'b2-64-batch' : 'b2-exact-one'),
            b2Remaining: state.b2Remaining,
            maxCraftable,
            emptySlotCount: inventory.emptySlotCount
        });

        const crafted = await this.#craft(
            chain.b2RecipeId,
            quantity,
            chain.b2Id,
            'B2',
            'B3',
            context
        );
        const actual = this.#actualCrafts(
            crafted,
            quantity,
            recipe.outputAmount
        );
        if (actual <= 0) {
            throw new FlowError(
                `B2 ${chain.b2Id} reported no completed crafts.`,
                {
                    code: 'CRAFT_B1_B3_B2_CRAFT_ZERO',
                    subsystem: 'crafting',
                    step: 'craft-b2',
                    action: 'verify B2 output',
                    resource: chain.b2Id,
                    retryable: true,
                    trace: context.trace
                }
            );
        }
        state.b2Remaining = Math.max(
            0,
            state.b2Remaining - actual
        );
        return true;
    }

    async #craftB3(chain, state, context) {
        const recipe = this.recipeRegistry.require(chain.b3RecipeId);
        const inventory = this.#snapshot();
        const inputPerCraft = Math.max(
            1,
            Number(chain.b3InputPerCraft || recipe.inputs?.[chain.b2Id] || 1)
        );
        const b2Count = this.inventoryCounter.count(
            inventory,
            chain.b2Id
        );
        const maxCraftable = Math.floor(
            b2Count / inputPerCraft
        );
        if (maxCraftable <= 0) return false;

        const quantity = this.inventoryState.allEnabled?.('useAllForB3') === true
            ? 'ALL'
            : (state.b3Remaining >= 64 && maxCraftable >= 64 ? 64 : 1);

        this.quantityTrace('CRAFT B1-B3 QUANTITY DECISION', {
            step: 'craft-b3',
            resource: chain.b3Id,
            recipeId: chain.b3RecipeId,
            quantity,
            reason: quantity === 'ALL'
                ? 'b3-all-with-available-b2'
                : (quantity === 64 ? 'b3-64-batch' : 'b3-exact-one'),
            b2Count,
            b3Remaining: state.b3Remaining,
            maxCraftable,
            emptySlotCount: inventory.emptySlotCount
        });

        const crafted = await this.#craft(
            chain.b3RecipeId,
            quantity,
            chain.b3Id,
            'B3',
            null,
            context
        );
        const actual = this.#actualCrafts(
            crafted,
            quantity,
            recipe.outputAmount
        );
        if (actual <= 0) {
            throw new FlowError(
                `B3 ${chain.b3Id} reported no completed crafts.`,
                {
                    code: 'CRAFT_B1_B3_CRAFT_ZERO',
                    subsystem: 'crafting',
                    step: 'craft-b3',
                    action: 'verify B3 output',
                    resource: chain.b3Id,
                    retryable: true,
                    trace: context.trace
                }
            );
        }
        state.b3Remaining = Math.max(
            0,
            state.b3Remaining - actual
        );
        return true;
    }

    #maxCraftable(inputs) {
        let result = Number.MAX_SAFE_INTEGER;
        for (const [id, perCraft] of Object.entries(inputs)) {
            const required = Math.max(1, Number(perCraft || 1));
            result = Math.min(
                result,
                Math.floor(this.#count(id) / required)
            );
        }
        return Number.isFinite(result)
            ? Math.max(0, result)
            : 0;
    }

    async #craft(recipeId, amount, outputId, stage, nextStage, context, craftOptions = {}) {
        const recipe = this.recipeRegistry.require(recipeId);
        const inputs = Object.keys(recipe.inputs || {});
        const before = this.verification.before(
            outputId,
            inputs,
            {
                inventorySource: 'all',
                connectionGeneration: context.connectionGeneration
            }
        );
        this.verification.arm(before);

        const crafted = await this.runStep(context, {
            subsystem: 'crafting',
            step: `craft-${String(stage).toLowerCase()}`,
            action: `craft quantity ${amount}`,
            resource: outputId,
            details: { recipeId, amount, stage, nextStage }
        }, () => this.crafting.craft(
            recipeId,
            amount,
            this.childOptions(context, { stage })
        ));

        const expectedDelta = Math.max(
            1,
            this.#actualCrafts(
                crafted?.data ?? crafted,
                amount,
                recipe.outputAmount
            ) * Math.max(1, Number(recipe.outputAmount || 1))
        );
        const after = await this.verification.after(
            outputId,
            before,
            {
                expectedDelta,
                connectionGeneration: context.connectionGeneration
            }
        );
        this.verification.verifyOutput({
            stage,
            logicalId: outputId,
            before: after?.before ?? before.count,
            after: after?.after ?? before.count,
            expectedDelta,
            context
        });
        const settlement = await this.verification.settleAfterCraft({
            outputId,
            before,
            verification: after,
            connectionGeneration: context.connectionGeneration
        });
        this.verification.requireSettled({
            stage,
            logicalId: outputId,
            settlement,
            context
        });
        this.verification.handoff({
            from: stage,
            to: nextStage || null,
            generation: context.connectionGeneration,
            context
        });

        return {
            ...(crafted?.data || crafted || {}),
            verification: after,
            actualCrafts: Math.max(
                1,
                Math.floor(
                    Math.max(
                        0,
                        Number(after?.delta || 0)
                    ) / Math.max(1, Number(recipe.outputAmount || 1))
                )
            ),
            stageContract: {
                stage,
                logicalId: outputId,
                before: after?.before ?? before.count,
                after: after?.after ?? before.count,
                expectedDelta,
                settled: true
            }
        };
    }

    #actualCrafts(result, requested, outputAmount = 1) {
        const explicit = Number(
            result?.actualCrafts
            ?? result?.crafts
            ?? result?.data?.actualCrafts
        );
        if (Number.isFinite(explicit) && explicit > 0) {
            return Math.max(1, Math.floor(explicit));
        }
        const outputDelta = Number(result?.verification?.delta);
        if (Number.isFinite(outputDelta) && outputDelta > 0) {
            return Math.max(
                1,
                Math.floor(outputDelta / Math.max(1, Number(outputAmount || 1)))
            );
        }
        return typeof requested === 'number'
            ? Math.max(0, Math.floor(requested))
            : 1;
    }

    async #ensureFreeSlot(chain, context) {
        const snapshot = this.inventoryState.spaceSnapshot();
        const required = Math.max(
            1,
            Number(this.config?.b3AllMinEmptySlots || 1)
        );
        if (Number(snapshot?.emptySlotCount || 0) >= required) {
            return false;
        }

        const candidates = [
            chain.b3Id,
            chain.b2Id
        ];
        for (const id of candidates) {
            if (this.#count(id) <= 0) continue;
            const result = await this.runStep(context, {
                subsystem: 'crafting',
                step: 'free-b1-b3-inventory-slot',
                action: 'store intermediate item to /pv 2 before next B1-B3 craft',
                resource: id
            }, () => this.personalVaultStorage.deposit(
                id,
                this.childOptions(context, { maxStacks: 1 })
            ));
            if (result?.success === false) continue;
            const after = this.inventoryState.spaceSnapshot();
            if (Number(after?.emptySlotCount || 0) >= required) {
                return true;
            }
        }
        return false;
    }

    async #depositReserve(chain, context) {
        for (const id of [chain.b3Id, chain.b2Id]) {
            if (this.#count(id) <= 0) continue;
            await this.runStep(context, {
                subsystem: 'crafting',
                step: 'store-b1-b3-reserve',
                action: 'store B1-B3 reserve to /pv 2',
                resource: id
            }, () => this.personalVaultStorage.deposit(
                id,
                this.childOptions(context)
            ));
        }
    }
}

module.exports = B1B3ReserveCoordinator;
