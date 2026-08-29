'use strict';

const FlowError = require('../../../shared/errors/FlowError');
const B5StageContract = require('./support/B5StageContract');

class B5FinalCraftCoordinator {
    constructor({ recipeRegistry, inventoryState, progressTracker, withdrawFlow, craftFlow, config, runStep, childOptions, quantityTrace }) {
        Object.assign(this, {
            recipeRegistry, inventoryState, progressTracker, withdrawFlow, craftFlow,
            config, runStep, childOptions, quantityTrace
        });
        this.stageContract = new B5StageContract();
    }

    reconfigure(config = {}) { this.config = config || {}; }

    async execute(steps, context) {
        const targetId = this.config?.targetId || 'super_alloy';
        for (let index = 0; index < steps.length; index += 1) {
            const step = steps[index];
            const recipe = this.recipeRegistry.require(step.recipeId);
            const outputId = step.outputId || recipe.output;
            const plannedCrafts = Number(step.crafts || 0);
            const stage = outputId === targetId ? 'B5' : 'B4';
            this.progressTracker.set({
                running: true,
                state: stage === 'B5' ? 'CRAFTING_B5' : 'CRAFTING_B4',
                currentStep: { kind: stage, id: outputId, crafts: plannedCrafts }
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
                const crafted = await this.craft(step.recipeId, decision.quantity, context, outputId, { stage });
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
            const lastVerification = this.#lastStageVerification(step, recipe, outputId, context);
            if (lastVerification) {
                await this.settleStage({
                    stage,
                    logicalId: outputId,
                    minimumCount: lastVerification.after,
                    context
                });
                const nextStageForHandoff = outputId === targetId
                    ? 'COMPLETE'
                    : (steps[index + 1]?.outputId === targetId ? 'B5' : 'B4');
                if (nextStageForHandoff !== 'B4' || stage !== 'B4') {
                    this.stageContract.handoff({
                        from: stage,
                        to: nextStageForHandoff,
                        generation: context.connectionGeneration,
                        context
                    });
                }
                if (context?.stageVerification?.logicalId === outputId) delete context.stageVerification;
            }
            this.progressTracker.advance(1, plannedCrafts);
        }
    }

    #lastStageVerification(step, recipe, outputId, context) {
        const latest = context?.stageVerification;
        if (latest?.logicalId === outputId && Number.isFinite(Number(latest.after))) return latest;
        if (typeof this.inventoryState.countFromSource !== 'function') return null;
        const current = this.inventoryState.countFromSource(outputId, 'bot-inventory');
        if (!Number.isFinite(Number(current))) return null;
        return { stage: outputId === (this.config?.targetId || 'super_alloy') ? 'B5' : 'B4', logicalId: outputId, after: Number(current), source: 'fresh-before-stage-settlement' };
    }

    async settleStage({ stage, logicalId, minimumCount, context }) {
        const settlement = await this.inventoryState.waitForSettledCount(logicalId, minimumCount, context.cancellation.token, {
            timeoutMs: this.config?.stageSettlementTimeoutMs,
            pollMs: this.config?.stageSettlementPollMs,
            quietMs: this.config?.stageSettlementQuietMs,
            stablePasses: this.config?.stageSettlementStablePasses,
            source: 'bot-inventory'
        });
        this.stageContract.requireSettled({ stage, logicalId, settlement, context });
        return settlement;
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
            this.stageContract.requireInputReady({ stage: 'INPUT', logicalId, available: inInventory, required: needed, context });
        }
    }

    async craft(recipeId, amount, context, outputId = null, options = {}) {
        const recipe = this.recipeRegistry.require(recipeId);
        const stage = String(options.stage || 'B4').trim() || 'B4';
        const beforeOutput = this.inventoryState.count(outputId || recipe.output);
        const result = await this.runStep(context, {
            subsystem: 'crafting', step: 'craft-recipe', action: `craft quantity ${amount}`, resource: outputId || recipeId,
            details: { recipeId, amount, stage, beforeOutput }
        }, () => this.craftFlow.craft(recipeId, amount, this.childOptions(context, options)));
        const data = result?.data || {};
        const actualCrafts = this.inventoryState.actualCrafts(data, amount);
        if (actualCrafts <= 0) {
            throw new FlowError(`Craft ${outputId || recipeId} did not expose a completed craft count.`, {
                code: 'B5_STAGE_OUTPUT_QUANTITY_UNCERTAIN', subsystem: 'b5', step: 'stage-output-verified',
                action: `verify completed crafts for ${recipeId}`, resource: outputId || recipeId, retryable: true,
                details: { recipeId, amount, stage, data }, trace: context.trace
            });
        }
        const verificationBefore = Number(data?.verification?.before);
        const verificationAfter = Number(data?.verification?.after);
        const expectedDelta = actualCrafts * Math.max(1, Number(recipe.outputAmount || 1));
        const baseline = Number.isFinite(verificationBefore) ? verificationBefore : beforeOutput;
        const observedAfter = Number.isFinite(verificationAfter) ? verificationAfter : this.inventoryState.countFromSource?.(outputId || recipe.output, 'bot-inventory');
        this.stageContract.verifyOutput({
            stage, logicalId: outputId || recipe.output, before: baseline,
            after: observedAfter, expectedDelta, context
        });
        if (context) {
            context.stageVerification = {
                stage, logicalId: outputId || recipe.output,
                before: baseline, after: observedAfter, expectedDelta
            };
        }
        return { ...data, stageContract: { stage, logicalId: outputId || recipe.output, before: baseline, after: observedAfter, expectedDelta, settled: false }, actualCrafts };
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
