'use strict';

class CraftingVerificationAttempt {
    constructor({ evidence, guiKnowledge = null }) {
        this.evidence = evidence;
        this.guiKnowledge = guiKnowledge;
    }

    async evaluate({ outputId, before, views, expectedDelta, inputRequirements, inventorySource, connectionGeneration, syncEvidence, attempt }) {
        let beforeCounted = this.evidence.countViews(before.views || [before.snapshot], outputId);
        let afterCounted = this.evidence.countViews(views, outputId);
        const snapshotMmoCandidates = this.evidence.positiveMmoCandidatesAcrossAllViews(before.views || [before.snapshot], views);
        const learned = await this.#learnOutputIfNeeded({ outputId, before, views, expectedDelta, inventorySource, connectionGeneration, beforeCounted, afterCounted });
        beforeCounted = learned.beforeCounted;
        afterCounted = learned.afterCounted;
        const expectedOutput = Math.max(1, Number(expectedDelta) || 1);
        const eventEvidence = this.evidence.eventEvidence(
            before?.verificationStartedAt || before?.capturedAt || 0,
            outputId,
            inputRequirements,
            inventorySource,
            connectionGeneration
        );
        const snapshotOutputDelta = Math.max(0, afterCounted.count - beforeCounted.count);
        const inputEvidence = this.evidence.inputConsumptionEvidence(before, views, inputRequirements, eventEvidence);
        const syncIdentityDelta = Math.max(0, Number(syncEvidence?.identityDelta) || 0);
        const syncIdentityVerified = Boolean(syncEvidence?.expectedIdentity)
            && syncIdentityDelta >= expectedOutput;
        const verificationMode = this.#verificationMode(
            snapshotOutputDelta,
            expectedOutput,
            eventEvidence,
            inputEvidence,
            syncIdentityVerified
        );
        return {
            verified: snapshotOutputDelta >= expectedOutput
                || Number(eventEvidence.outputDelta || 0) >= expectedOutput
                || syncIdentityVerified
                || inputEvidence.some(entry => entry.verified),
            verificationMode,
            before: beforeCounted.count,
            after: afterCounted.count,
            delta: afterCounted.count - beforeCounted.count,
            snapshot: afterCounted.snapshot,
            views,
            countsBySource: afterCounted.countsBySource,
            beforeCountsBySource: beforeCounted.countsBySource,
            inputEvidence,
            eventEvidence,
            snapshotMmoCandidates: snapshotMmoCandidates.map(candidate => ({
                identity: candidate.identity, delta: candidate.delta, before: candidate.before, after: candidate.after,
                bySourceBefore: candidate.bySourceBefore, bySourceAfter: candidate.bySourceAfter
            })),
            attempt,
            learnedIdentity: learned.learnedIdentity,
            inventorySource,
            syncEvidence: this.#syncSummary(syncEvidence)
        };
    }

    async #learnOutputIfNeeded({ outputId, before, views, expectedDelta, inventorySource, connectionGeneration, beforeCounted, afterCounted }) {
        if (afterCounted.count > beforeCounted.count || !this.guiKnowledge?.learnLogicalItem) {
            return { beforeCounted, afterCounted, learnedIdentity: null };
        }
        let candidate = this.evidence.bestPositiveMmoDeltaAcrossAllViews(before.views || [before.snapshot], views, expectedDelta)
            || this.evidence.bestPositiveMmoDeltaAcrossViews(before.views || [before.snapshot], views, expectedDelta)
            || this.evidence.bestPositiveMmoDeltaFromEvents(
                before?.verificationStartedAt || before?.capturedAt || 0,
                expectedDelta,
                inventorySource,
                connectionGeneration
            );
        candidate = this.#rejectConfiguredDifferentLogical(candidate, outputId);
        if (!candidate) return { beforeCounted, afterCounted, learnedIdentity: null };
        await this.guiKnowledge.learnLogicalItem(outputId, candidate.item, {
            source: candidate.source || 'craft-output-delta',
            roleId: `output:${outputId}`
        });
        return {
            beforeCounted: this.evidence.countViews(before.views || [before.snapshot], outputId),
            afterCounted: this.evidence.countViews(views, outputId),
            learnedIdentity: candidate.identity
        };
    }

    #rejectConfiguredDifferentLogical(candidate, outputId) {
        if (!candidate) return null;
        const configured = this.guiKnowledge?.getConfiguredStrongLogicalId?.(candidate.item, 'inventory')
            || this.guiKnowledge?.getConfiguredStrongLogicalId?.(candidate.item, 'personal-vault')
            || null;
        return configured && configured !== outputId ? null : candidate;
    }

    #verificationMode(snapshotOutputDelta, expectedOutput, eventEvidence, inputEvidence, syncIdentityVerified) {
        if (snapshotOutputDelta >= expectedOutput) return 'output-snapshot-delta';
        if (Number(eventEvidence.outputDelta || 0) >= expectedOutput) return 'output-event-delta';
        if (syncIdentityVerified) return 'output-identity-sync';
        if (inputEvidence.some(entry => entry.snapshotVerified)) return 'input-snapshot-consumption';
        if (inputEvidence.some(entry => entry.eventVerified)) return 'input-event-consumption';
        return 'none';
    }

    #syncSummary(syncEvidence) {
        if (!syncEvidence) return null;
        return {
            stable: Boolean(syncEvidence.stable), timedOut: Boolean(syncEvidence.timedOut), elapsedMs: syncEvidence.elapsedMs ?? null,
            eventCount: syncEvidence.eventCount ?? 0, stablePasses: syncEvidence.stablePasses ?? 0, quietForMs: syncEvidence.quietForMs ?? 0,
            expectedIdentity: syncEvidence.expectedIdentity || null, beforeIdentityCount: syncEvidence.beforeIdentityCount ?? null,
            afterIdentityCount: syncEvidence.afterIdentityCount ?? null, identityDelta: syncEvidence.identityDelta ?? null,
            metadataReady: syncEvidence.metadataReady ?? null
        };
    }
}

module.exports = CraftingVerificationAttempt;
