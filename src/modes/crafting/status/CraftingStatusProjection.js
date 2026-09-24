'use strict';

class CraftingStatusProjection {
    static create(source = {}) {
        return {
            policy: { ...source.policy },
            craftRequest: source.craftRequest || null,
            preparedGeneration: source.preparedGeneration ?? null,
            lastCycleAt: source.lastCycleAt ?? null,
            waitingReason: source.waitingReason ?? null,
            cycles: Number(source.cycles || 0), completedTargets: Number(source.completedTargets || 0),
            storageProtectionRuns: Number(source.storageProtectionRuns || 0),
            lastAutomationBlockers: [...(source.lastAutomationBlockers || [])],
            automationRuns: Number(source.automationRuns || 0), productiveCycles: Number(source.productiveCycles || 0),
            lastAutomationAt: source.lastAutomationAt ?? null, noProgressStreak: Number(source.noProgressStreak || 0),
            lastBlockerKey: source.lastBlockerKey ?? null, lastCycleDelayMs: Number(source.lastCycleDelayMs || 0),
            staleGenerationAborts: Number(source.staleGenerationAborts || 0), manualResumeGeneration: source.manualResumeGeneration ?? null,
            reconciliationRuns: Number(source.reconciliationRuns || 0), unresolvedReconciliations: Number(source.unresolvedReconciliations || 0),
            nextCycleAt: source.nextCycleAt ?? null, campaign: source.campaign || null,
            batchId: source.batchId ?? null, batchTrigger: source.batchTrigger ?? null,
            batchProtectionRequired: source.batchProtectionRequired === true,
            batchProtectionCompleted: source.batchProtectionCompleted === true,
            protectionInFlight: source.protectionInFlight || null, protectionEpisode: source.protectionEpisode || null,
            fault: source.fault || null, recovery: source.recovery || null,
            pendingCraftReconciliation: source.pendingCraftReconciliation || null,
            pendingCompletionProvenance: source.pendingCompletionProvenance || null,
            reconciliationAction: source.reconciliationAction || null,
            lastResult: source.lastResult || null, automation: source.automation || null,
            configApply: source.configApply || { pending: false, revision: 0 },
            sharedStorageLease: source.sharedStorageLease || null,
            storage: source.storage || null, tasks: source.tasks || null
        };
    }
}

module.exports = CraftingStatusProjection;
