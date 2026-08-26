'use strict';

const Timeout = require('../../shared/time/Timeout');
const CraftingVerificationEvidence = require('./verification/CraftingVerificationEvidence');
const CraftingVerificationAttempt = require('./verification/CraftingVerificationAttempt');

class CraftingResultVerifier {
    constructor({ inventoryReader, inventoryCounter, guiKnowledge = null, inventoryObservation = null, inventorySync = null }) {
        Object.assign(this, { inventoryReader, inventoryCounter, guiKnowledge, inventoryObservation, inventorySync });
        this.evidence = new CraftingVerificationEvidence({ inventoryReader, inventoryCounter, guiKnowledge, inventoryObservation });
        this.attemptEvaluator = new CraftingVerificationAttempt({ evidence: this.evidence, guiKnowledge });
    }

    before(outputId, inputIds = [], { inventorySource = 'all', connectionGeneration = null } = {}) {
        const views = this.evidence.readViews(inventorySource);
        const counted = this.evidence.countViews(views, outputId);
        const inputCounts = {};
        for (const inputId of inputIds || []) {
            if (!inputId) continue;
            inputCounts[inputId] = this.evidence.countViews(views, inputId);
        }
        return {
            snapshot: counted.snapshot,
            views,
            count: counted.count,
            countsBySource: counted.countsBySource,
            inputCounts,
            mmoTotals: this.evidence.aggregateMmoTotalsAcrossViews(views),
            capturedAt: Date.now(),
            verificationStartedAt: null,
            inventorySource,
            connectionGeneration: Number.isInteger(Number(connectionGeneration)) && Number(connectionGeneration) > 0
                ? Number(connectionGeneration)
                : null
        };
    }

    arm(before) {
        if (!before || typeof before !== 'object') return Date.now();
        const now = Date.now();
        before.verificationStartedAt = now;
        return now;
    }

    async after(outputId, before, {
        attempts = 10,
        retryMs = 300,
        expectedDelta = null,
        inputRequirements = null,
        inventorySource = before?.inventorySource || 'all',
        connectionGeneration = before?.connectionGeneration ?? null
    } = {}) {
        const maxAttempts = Math.max(1, Number(attempts) || 1);
        const delayMs = Math.max(0, Number(retryMs) || 0);
        const syncEvidence = await this.#syncBeforeAttempts(outputId, before, expectedDelta, inventorySource, connectionGeneration);
        let last = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            const views = this.evidence.readViews(inventorySource);
            last = await this.attemptEvaluator.evaluate({
                outputId, before, views, expectedDelta, inputRequirements, inventorySource, connectionGeneration, syncEvidence, attempt
            });
            if (last.verified) return last;
            if (attempt < maxAttempts && delayMs > 0) await Timeout.delay(delayMs);
        }
        return last || this.#emptyResult(before, inventorySource);
    }

    #syncBeforeAttempts(outputId, before, expectedDelta, inventorySource, connectionGeneration) {
        if (!this.inventorySync) return null;
        return this.inventorySync.waitForStable({
            since: before?.verificationStartedAt || before?.capturedAt || Date.now(),
            beforeViews: before?.views || [before?.snapshot].filter(Boolean),
            reason: `craft:${outputId}`,
            expectedIdentity: this.guiKnowledge?.getStrongIdentity?.(outputId) || null,
            expectedDelta,
            inventorySource,
            expectedGeneration: connectionGeneration
        });
    }

    #emptyResult(before, inventorySource) {
        return {
            verified: false, before: before.count, after: before.count, delta: 0, snapshot: before.snapshot,
            views: before.views || [before.snapshot], countsBySource: before.countsBySource || {}, beforeCountsBySource: before.countsBySource || {},
            inputEvidence: [], eventEvidence: { outputDelta: 0, outputBySource: {}, inputs: {}, eventCount: 0, mmoCandidates: [] },
            snapshotMmoCandidates: [], verificationMode: 'none', inventorySource, attempt: 0, syncEvidence: null
        };
    }

}

module.exports = CraftingResultVerifier;
