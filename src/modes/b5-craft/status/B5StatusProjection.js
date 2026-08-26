'use strict';

class B5StatusProjection {
    static create(source = {}) {
        return {
            policy: { ...source.policy },
            preparedGeneration: source.preparedGeneration ?? null,
            lastCycleAt: source.lastCycleAt ?? null,
            waitingReason: source.waitingReason ?? null,
            cycles: Number(source.cycles || 0), completedB5: Number(source.completedB5 || 0),
            storageProtectionRuns: Number(source.storageProtectionRuns || 0),
            lastAutomationBlockers: [...(source.lastAutomationBlockers || [])],
            automationRuns: Number(source.automationRuns || 0), productiveCycles: Number(source.productiveCycles || 0),
            lastAutomationAt: source.lastAutomationAt ?? null, noProgressStreak: Number(source.noProgressStreak || 0),
            lastBlockerKey: source.lastBlockerKey ?? null, lastCycleDelayMs: Number(source.lastCycleDelayMs || 0),
            staleGenerationAborts: Number(source.staleGenerationAborts || 0), manualResumeGeneration: source.manualResumeGeneration ?? null,
            reconciliationRuns: Number(source.reconciliationRuns || 0), unresolvedReconciliations: Number(source.unresolvedReconciliations || 0),
            nextB5CycleAt: source.nextB5CycleAt ?? null, campaign: source.campaign || null,
            batchId: source.batchId ?? null, batchTrigger: source.batchTrigger ?? null,
            batchProtectionRequired: source.batchProtectionRequired === true,
            batchProtectionCompleted: source.batchProtectionCompleted === true,
            protectionInFlight: source.protectionInFlight || null, protectionEpisode: source.protectionEpisode || null,
            fault: source.fault || null, recovery: source.recovery || null,
            pendingCraftReconciliation: source.pendingCraftReconciliation || null,
            pendingB5CompletionProvenance: source.pendingB5CompletionProvenance || null,
            reconciliationAction: source.reconciliationAction || null,
            lastResult: source.lastResult || null, b5Automation: source.b5Automation || null,
            configApply: source.configApply || { pending: false, revision: 0 },
            sharedStorageLease: source.sharedStorageLease || null,
            storage: source.storage || null, tasks: source.tasks || null
        };
    }
}

module.exports = B5StatusProjection;
