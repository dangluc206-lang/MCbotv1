'use strict';

const CraftingOutcomeClassifier = require('./CraftingOutcomeClassifier');

class CraftingVerificationCoordinator {
    constructor({ resultVerifier, guiKnowledge = null, guiManager, config, support, trace, flow }) {
        Object.assign(this, { resultVerifier, guiKnowledge, guiManager, config, support, trace, flow });
    }

    reconfigure(config) { this.config = config; }

    async verify({
        recipeId, recipe, quantity, before, baseDetails, effectiveInputSource,
        reconciliationBaseline = null, expectedGeneration = null, bot,
        startedAt, entrySlot, recipeSlot, quantitySlot
    }) {
        const minimumCrafts = quantity === 'ALL' ? 1 : quantity;
        const verification = await this.resultVerifier.after(recipe.output, before, {
            attempts: this.config.resultVerifyAttempts,
            retryMs: this.config.resultVerifyRetryMs,
            expectedDelta: Number(recipe.outputAmount || 1) * minimumCrafts,
            inventorySource: 'bot-inventory',
            connectionGeneration: expectedGeneration,
            inputRequirements: Object.fromEntries(Object.entries(recipe.inputs || {}).map(([inputId, perCraft]) => [
                inputId,
                {
                    amount: Number(perCraft || 0) * minimumCrafts,
                    perCraft: Number(perCraft || 0),
                    source: effectiveInputSource(inputId)
                }
            ]))
        });
        if (!verification.verified) {
            throw this.#uncertain({
                recipeId, recipe, quantity, before, baseDetails, effectiveInputSource,
                reconciliationBaseline, verification, bot
            });
        }
        const actualCrafts = this.support.deriveActualCrafts(recipe, quantity, verification);
        this.trace('CRAFT OK', 'verify-output', {
            recipeId, resource: recipe.output, quantity, phase: 'OK',
            before: verification.before, after: verification.after,
            actualCrafts,
            producedAmount: actualCrafts * Number(recipe.outputAmount || 1),
            verificationMode: verification.verificationMode || null,
            elapsedMs: Date.now() - startedAt
        });
        return {
            recipeId,
            amount: quantity,
            quantityAction: quantity,
            actualCrafts,
            producedAmount: actualCrafts * Number(recipe.outputAmount || 1),
            entrySlot,
            recipeSlot,
            quantitySlot,
            verification
        };
    }

    #uncertain({ recipeId, recipe, quantity, before, baseDetails, effectiveInputSource, reconciliationBaseline, verification, bot }) {
        const outcome = CraftingOutcomeClassifier.classify(verification, {
            recipeId, outputId: recipe.output, quantity
        });
        const inputBaselines = {};
        const inputCountsBefore = {};
        for (const [inputId] of Object.entries(recipe.inputs || {})) {
            const source = effectiveInputSource(inputId);
            const supplied = reconciliationBaseline?.inputs?.[inputId] || null;
            let count = null;
            if (supplied && String(supplied.source || source) === source && Number.isFinite(Number(supplied.count))) {
                count = Math.max(0, Number(supplied.count));
            } else if (source === 'inventory') {
                const counted = before?.inputCounts?.[inputId] || null;
                const observed = Number(counted?.countsBySource?.['bot-inventory'] ?? counted?.count);
                if (Number.isFinite(observed)) count = Math.max(0, observed);
            }
            inputBaselines[inputId] = { source, count };
            if (Number.isFinite(count)) inputCountsBefore[inputId] = count;
        }
        const outputCountBefore = Number(before?.countsBySource?.['bot-inventory'] ?? before?.count ?? verification.before ?? 0);
        return this.flow('CRAFTING_OUTCOME_UNCERTAIN', 'verify-output', `reconcile quantity ${quantity}`, recipe.output, {
            ...baseDetails,
            expectedDelta: Number(recipe.outputAmount || 1) * (quantity === 'ALL' ? 1 : quantity),
            before: verification.before,
            after: verification.after,
            reconciliationBaseline: {
                output: { source: 'inventory', count: Math.max(0, outputCountBefore) },
                outputCountBefore: Math.max(0, outputCountBefore),
                inputs: inputBaselines,
                inputCountsBefore
            },
            outcome,
            attempts: verification.attempt,
            viewsBefore: verification.beforeCountsBySource || {},
            viewsAfter: verification.countsBySource || {},
            learnedIdentity: verification.learnedIdentity || null,
            verificationMode: verification.verificationMode || 'none',
            inputEvidence: verification.inputEvidence || [],
            eventEvidence: verification.eventEvidence || null,
            eventOutputDelta: verification.eventEvidence?.outputDelta ?? 0,
            eventMmoCandidates: verification.eventEvidence?.mmoCandidates || [],
            snapshotMmoCandidates: verification.snapshotMmoCandidates || [],
            eventIdentitySamples: verification.eventEvidence?.identitySamples || [],
            eventCount: verification.eventEvidence?.eventCount ?? 0,
            outputIdentity: this.guiKnowledge?.getStrongIdentity?.(recipe.output) || null,
            outputBinding: this.guiKnowledge?.getLogicalBinding?.(recipe.output) || null,
            inventorySync: verification.syncEvidence || null,
            inventorySource: verification.inventorySource || 'bot-inventory',
            currentWindowId: bot.currentWindow?.id ?? null,
            gui: this.guiManager.describeCurrent()
        }, { retryable: false });
    }
}

module.exports = CraftingVerificationCoordinator;
