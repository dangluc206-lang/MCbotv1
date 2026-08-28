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
        connectionGeneration = before?.connectionGeneration ?? null,
        skipInitialSync = false
    } = {}) {
        const maxAttempts = Math.max(1, Number(attempts) || 1);
        const delayMs = Math.max(0, Number(retryMs) || 0);
        // Do not gate output verification on global inventory stability.
        // The server may deliver inventory mutations in multiple packets; the
        // output itself is the primary completion signal. Settlement is handled
        // separately after output confirmation.
        const syncEvidence = null;
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

    async waitForOutputCompletion({
        outputId,
        before,
        expectedDelta = 1,
        inventorySource = before?.inventorySource || 'all',
        connectionGeneration = before?.connectionGeneration ?? null,
        timeoutMs = 8000,
        pollMs = 50
    } = {}) {
        const since = before?.verificationStartedAt || before?.capturedAt || Date.now();
        const targetDelta = Math.max(1, Number(expectedDelta) || 1);
        const deadline = Date.now() + Math.max(1, Number(timeoutMs) || 1);
        let last = null;

        while (Date.now() <= deadline) {
            const views = this.evidence.readViews(inventorySource);
            const beforeCounted = this.evidence.countViews(before?.views || [before?.snapshot], outputId);
            const afterCounted = this.evidence.countViews(views, outputId);
            const snapshotDelta = Math.max(0, afterCounted.count - beforeCounted.count);
            const events = this.evidence.eventEvidence(
                since,
                outputId,
                {},
                inventorySource,
                connectionGeneration
            );
            const eventDelta = Math.max(0, Number(events?.outputDelta || 0));
            last = {
                observed: snapshotDelta >= targetDelta || eventDelta >= targetDelta,
                mode: snapshotDelta >= targetDelta ? 'output-snapshot-delta' : (eventDelta >= targetDelta ? 'output-event-delta' : 'none'),
                outputId,
                before: beforeCounted.count,
                after: afterCounted.count,
                snapshotDelta,
                eventDelta,
                eventCount: Number(events?.eventCount || 0),
                observedAt: Date.now(),
                views
            };
            if (last.observed) return last;
            const remaining = deadline - Date.now();
            if (remaining <= 0) break;
            await Timeout.delay(Math.min(Math.max(0, Number(pollMs) || 0), remaining));
        }

        return { ...(last || {}), observed: false, timedOut: true, outputId };
    }

    async settleAfterCraft({
        outputId,
        before,
        verification,
        inventorySource = before?.inventorySource || 'all',
        connectionGeneration = before?.connectionGeneration ?? null,
        since = null
    } = {}) {
        if (!this.inventorySync) return null;

        const settlementSince = Number(since) > 0
            ? Number(since)
            : (before?.verificationStartedAt || before?.capturedAt || Date.now());
        return this.inventorySync.waitForStable({
            since: settlementSince,
            beforeViews: verification?.views || before?.views || [before?.snapshot].filter(Boolean),
            reason: `craft:settlement:${outputId}`,
            inventorySource,
            expectedGeneration: connectionGeneration
        });
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
