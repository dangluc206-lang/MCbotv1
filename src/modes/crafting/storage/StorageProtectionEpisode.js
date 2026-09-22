'use strict';

class StorageProtectionEpisode {
    static create({ batchId, trigger, evidenceKey } = {}) {
        if (!batchId) throw new TypeError('StorageProtectionEpisode batchId is required.');
        const episodeId = `${batchId}:storage-protection`;
        return {
            batchId, episodeId, correlationId: episodeId, trigger,
            state: 'PENDING', attemptsStarted: 0, totalAttempts: 0,
            businessFailureAttempts: 0, staleAborts: 0, sameBlockerAttempts: 0,
            continuationSlices: 0, lastProgress: null, blocker: null, baselineDigest: null,
            lastBlockerSignature: null, lastAttemptGeneration: null,
            lastAttemptAt: null, nextEligibleAt: 0, evidenceKey,
            operatorRetryRequested: false, generationRetryPending: false,
            completedGeneration: null, completedAt: null
        };
    }
}

module.exports = StorageProtectionEpisode;
