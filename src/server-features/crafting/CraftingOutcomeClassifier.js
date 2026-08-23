'use strict';

function positiveNumber(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) && number > 0 ? number : 0;
}

function candidateDeltas(values) {
    return (Array.isArray(values) ? values : [])
        .map(candidate => ({
            identity: candidate?.identity || null,
            delta: positiveNumber(candidate?.delta)
        }))
        .filter(candidate => candidate.delta > 0);
}

class CraftingOutcomeClassifier {
    static classify(verification, { recipeId = null, outputId = null, quantity = null } = {}) {
        if (verification?.verified === true) {
            return Object.freeze({
                state: 'VERIFIED',
                requiresReconciliation: false,
                safeToBlindRetry: false,
                observedSideEffect: true,
                recipeId,
                outputId,
                quantity
            });
        }

        const eventEvidence = verification?.eventEvidence || {};
        const inputEvidence = Array.isArray(verification?.inputEvidence) ? verification.inputEvidence : [];
        const snapshotCandidates = candidateDeltas(verification?.snapshotMmoCandidates);
        const eventCandidates = candidateDeltas(eventEvidence?.mmoCandidates);
        const inputConsumption = inputEvidence
            .map(entry => ({
                inputId: entry?.inputId || null,
                consumed: positiveNumber(entry?.consumed),
                source: entry?.source || null
            }))
            .filter(entry => entry.consumed > 0);
        const expectedOutputDelta = Math.max(
            positiveNumber(verification?.delta),
            positiveNumber(eventEvidence?.outputDelta)
        );
        const unexpectedIdentityDeltas = [...snapshotCandidates, ...eventCandidates];
        const observedSideEffect = expectedOutputDelta > 0
            || inputConsumption.length > 0
            || unexpectedIdentityDeltas.length > 0;

        // Once the quantity button has been clicked, a failed verifier means the
        // server outcome is unknown. Absence of a mirrored inventory delta is not
        // proof that the server did nothing, so callers must reconcile fresh state
        // before any identical mutation is attempted again.
        return Object.freeze({
            state: 'UNCERTAIN',
            requiresReconciliation: true,
            safeToBlindRetry: false,
            observedSideEffect,
            expectedOutputDelta,
            inputConsumption,
            unexpectedIdentityDeltas,
            eventCount: Math.max(0, Number(eventEvidence?.eventCount || 0)),
            syncTimedOut: verification?.syncEvidence?.timedOut === true,
            verificationMode: verification?.verificationMode || 'none',
            recipeId,
            outputId,
            quantity
        });
    }
}

module.exports = CraftingOutcomeClassifier;
