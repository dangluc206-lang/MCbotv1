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
        const expectedOutput = Number(recipe.outputAmount || 1) * minimumCrafts;
        let verification = await this.resultVerifier.after(recipe.output, before, {
            attempts: this.config.resultVerifyAttempts,
            retryMs: this.config.resultVerifyRetryMs,
            expectedDelta: expectedOutput,
            inventorySource: 'bot-inventory',
            connectionGeneration: expectedGeneration,
            skipInitialSync: true,
            inputRequirements: Object.fromEntries(Object.entries(recipe.inputs || {}).map(([inputId, perCraft]) => [
                inputId,
                {
                    amount: Number(perCraft || 0) * minimumCrafts,
                    perCraft: Number(perCraft || 0),
                    source: effectiveInputSource(inputId)
                }
            ]))
        });

        let outputCompletion = null;
        if (!verification.verified) {
            outputCompletion = await this.resultVerifier.waitForOutputCompletion?.({
                outputId: recipe.output,
                before,
                expectedDelta: Math.max(1, Number(recipe.outputAmount || 1)),
                inventorySource: 'bot-inventory',
                connectionGeneration: expectedGeneration,
                timeoutMs: this.config.outputCompletionTimeoutMs,
                pollMs: this.config.outputCompletionPollMs
            });

            if (!outputCompletion?.observed) {
                throw this.#uncertain({
                    recipeId, recipe, quantity, before, baseDetails, effectiveInputSource,
                    reconciliationBaseline, verification, bot
                });
            }

            // Re-read once after the output was observed so downstream craft
            // accounting uses the freshest logical count available.
            const refreshed = await this.resultVerifier.after(recipe.output, before, {
                attempts: 1,
                retryMs: 0,
                expectedDelta: expectedOutput,
                inventorySource: 'bot-inventory',
                connectionGeneration: expectedGeneration,
                skipInitialSync: true,
                inputRequirements: Object.fromEntries(Object.entries(recipe.inputs || {}).map(([inputId, perCraft]) => [
                    inputId,
                    {
                        amount: Number(perCraft || 0) * minimumCrafts,
                        perCraft: Number(perCraft || 0),
                        source: effectiveInputSource(inputId)
                    }
                ]))
            });

            verification = refreshed.verified ? refreshed : {
                ...verification,
                verified: true,
                before: Number(before?.count || 0),
                after: Number(before?.count || 0) + Math.max(0, Number(outputCompletion.snapshotDelta || outputCompletion.eventDelta || 0)),
                delta: Math.max(0, Number(outputCompletion.snapshotDelta || outputCompletion.eventDelta || 0)),
                verificationMode: outputCompletion.mode || 'output-completion',
                views: outputCompletion.views || verification.views,
                countsBySource: refreshed.countsBySource || verification.countsBySource,
                beforeCountsBySource: refreshed.beforeCountsBySource || verification.beforeCountsBySource,
                eventEvidence: refreshed.eventEvidence || verification.eventEvidence,
                inputEvidence: refreshed.inputEvidence || verification.inputEvidence
            };
        }

        const settlement = await this.resultVerifier.settleAfterCraft?.({
            outputId: recipe.output,
            before,
            verification: { ...verification, outputCompletion },
            inventorySource: 'bot-inventory',
            connectionGeneration: expectedGeneration,
            since: outputCompletion?.observedAt || null
        });

        // A settlement timeout means the server is still streaming unrelated
        // inventory updates. It must not undo a craft whose output was already
        // proven. Keep the timeout as diagnostic state for the caller.
        if (settlement?.timedOut) {
            this.trace('CRAFT SETTLEMENT PENDING', 'verify-output', {
                recipeId, resource: recipe.output, quantity, phase: 'INFO',
                settlementElapsedMs: settlement.elapsedMs ?? null,
                eventCount: settlement.eventCount ?? 0,
                stablePasses: settlement.stablePasses ?? 0,
                quietForMs: settlement.quietForMs ?? 0,
                expectedGeneration,
                inventorySource: 'bot-inventory'
            });
        }

        const actualCrafts = this.support.deriveActualCrafts(recipe, quantity, verification);
        this.trace('CRAFT OK', 'verify-output', {
            recipeId, resource: recipe.output, quantity, phase: 'OK',
            before: verification.before, after: verification.after,
            actualCrafts,
            producedAmount: actualCrafts * Number(recipe.outputAmount || 1),
            verificationMode: verification.verificationMode || null,
            settlementMode: settlement ? (settlement.timedOut ? 'post-craft-timeout' : 'post-craft-stable') : 'not-required',
            settlementElapsedMs: settlement?.elapsedMs ?? 0,
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
            verification,
            settlement
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
