'use strict';

const FlowError = require('../../../shared/errors/FlowError');

class B5FinalCraftCoordinator {
    constructor({ recipeRegistry, inventoryState, progressTracker, withdrawFlow, craftFlow, config, runStep, childOptions, quantityTrace }) {
        Object.assign(this, {
            recipeRegistry, inventoryState, progressTracker, withdrawFlow, craftFlow,
            config, runStep, childOptions, quantityTrace
        });
    }

    reconfigure(config = {}) { this.config = config || {}; }

    async execute(steps, context) {
        const targetId = this.config?.targetId || 'super_alloy';
        for (const step of steps) {
            const recipe = this.recipeRegistry.require(step.recipeId);
            const outputId = step.outputId || recipe.output;
            const plannedCrafts = Number(step.crafts || 0);
            this.progressTracker.set({
                running: true,
                state: outputId === targetId ? 'CRAFTING_B5' : 'CRAFTING_B4',
                currentStep: { kind: outputId === targetId ? 'B5' : 'B4', id: outputId, crafts: plannedCrafts }
            });
            let remaining = plannedCrafts;
            while (remaining > 0) {
                context.cancellation.token.throwIfCancelled();
                await this.ensureInputs(recipe.inputs || {}, remaining, context, step.recipeId);
                const maxCraftable = this.inventoryState.maxCraftable(recipe.inputs || {});
                const decision = this.#quantity(step, recipe, remaining, maxCraftable, targetId);
                this.quantityTrace('B5 QUANTITY DECISION', {
                    step: 'craft-final-chain', resource: outputId, recipeId: step.recipeId,
                    quantity: decision.quantity, reason: decision.reason, remaining, maxCraftable
                });
                const crafted = await this.craft(step.recipeId, decision.quantity, context, outputId);
                const actualCrafts = this.inventoryState.actualCrafts(crafted, decision.quantity);
                if (actualCrafts <= 0) {
                    throw new FlowError(`Craft ${outputId} reported no completed crafts.`, {
                        code: 'B5_FINAL_CRAFT_ZERO', subsystem: 'b5', step: 'craft-final-chain',
                        action: `craft quantity ${decision.quantity}`, resource: outputId,
                        details: { quantity: decision.quantity, remaining, maxCraftable, crafted }, trace: context.trace
                    });
                }
                remaining = Math.max(0, remaining - actualCrafts);
            }
            this.progressTracker.advance(1, plannedCrafts);
        }
    }

    async ensureInputs(inputs, craftAmount, context, recipeId) {
        for (const [logicalId, perCraft] of Object.entries(inputs)) {
            const needed = Number(perCraft) * craftAmount;
            let inInventory = this.inventoryState.count(logicalId);
            let shortage = Math.max(0, needed - inInventory);
            let attempts = 0;
            let lastWithdrawal = null;
            while (shortage > 0 && attempts < 8) {
                attempts += 1;
                const maxStacks = Math.max(1, Math.ceil(shortage / 64));
                const withdrawn = await this.runStep(context, {
                    subsystem: 'b5', step: 'withdraw-final-input', action: 'withdraw from /pv 2', resource: logicalId,
                    details: { recipeId, needed, inInventory, shortage, maxStacks, attempt: attempts }
                }, () => this.withdrawFlow.withdraw(logicalId, this.childOptions(context, { maxStacks })));
                lastWithdrawal = withdrawn?.data || null;
                const after = await this.inventoryState.waitForIncrease(logicalId, inInventory, context.cancellation.token);
                if (after <= inInventory) break;
                inInventory = after;
                shortage = Math.max(0, needed - inInventory);
            }
            if (inInventory < needed) this.#throwInputError(logicalId, recipeId, needed, inInventory, attempts, lastWithdrawal, context);
        }
    }

    async craft(recipeId, amount, context, outputId = null, options = {}) {
        const result = await this.runStep(context, {
            subsystem: 'crafting', step: 'craft-recipe', action: `craft quantity ${amount}`, resource: outputId || recipeId,
            details: { recipeId, amount }
        }, () => this.craftFlow.craft(recipeId, amount, this.childOptions(context, options)));
        return result.data;
    }

    #quantity(step, recipe, remaining, maxCraftable, targetId) {
        const outputId = step.outputId || recipe.output;
        let quantity = 1;
        let reason = 'exact-one';
        if (outputId !== targetId && this.inventoryState.allEnabled('useAllForB4WhenExact') && remaining > 1 && maxCraftable === remaining) {
            quantity = 'ALL'; reason = 'all-is-exact-for-current-b4-inputs';
        } else if (remaining >= 64 && maxCraftable >= 64) {
            quantity = 64; reason = 'exact-64-batch';
        }
        if (outputId === targetId && !this.inventoryState.allEnabled('useAllForB5')) {
            quantity = remaining >= 64 ? 64 : 1; reason = 'final-target-exact-cycle';
        }
        return { quantity, reason };
    }

    #throwInputError(logicalId, recipeId, needed, inInventory, attempts, lastWithdrawal, context) {
        const verification = lastWithdrawal?.verification || null;
        const vaultMoved = Number(verification?.afterVault) < Number(verification?.beforeVault);
        throw new FlowError(vaultMoved
            ? `/pv 2 moved ${logicalId}, but the player inventory did not expose the item in time (${inInventory}/${needed}).`
            : `Not enough ${logicalId} in inventory after /pv 2 withdrawal (${inInventory}/${needed}).`, {
            code: vaultMoved ? 'PV_WITHDRAW_INVENTORY_SYNC_TIMEOUT' : 'PV_WITHDRAW_VERIFICATION_FAILED',
            subsystem: 'b5', step: 'withdraw-final-input', action: 'verify inventory after withdrawal',
            resource: logicalId, retryable: true,
            details: { recipeId, needed, after: inInventory, attempts, withdrawalVerification: verification, movedStacks: lastWithdrawal?.movedStacks ?? null },
            trace: context.trace
        });
    }
}

module.exports = B5FinalCraftCoordinator;
