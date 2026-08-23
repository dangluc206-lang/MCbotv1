'use strict';

const Outcome = Object.freeze({
    APPLIED: 'APPLIED',
    NOT_APPLIED: 'NOT_APPLIED',
    UNRESOLVED: 'UNRESOLVED',
    STALE: 'STALE',
    CANCELLED: 'CANCELLED',
    RESOURCE_BUSY: 'RESOURCE_BUSY'
});

function frozen(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) frozen(child);
    return Object.freeze(value);
}

class ReconciliationBarrier {
    constructor({ maxFreshReads = 2, logger = null } = {}) {
        this.maxFreshReads = Math.max(1, Math.min(32, Number(maxFreshReads) || 2));
        this.logger = logger;
    }

    evaluate({ expectedGeneration = null, currentGeneration = expectedGeneration, cancelled = false, applied = false, verifiedNoEffect = false, evidence = null } = {}) {
        let outcome = Outcome.UNRESOLVED;
        if (cancelled) outcome = Outcome.CANCELLED;
        else if (expectedGeneration !== null && currentGeneration !== null && Number(expectedGeneration) !== Number(currentGeneration)) outcome = Outcome.STALE;
        else if (applied) outcome = Outcome.APPLIED;
        else if (verifiedNoEffect) outcome = Outcome.NOT_APPLIED;
        return frozen({
            outcome,
            resolved: outcome === Outcome.APPLIED || outcome === Outcome.NOT_APPLIED,
            blocksMutation: outcome !== Outcome.NOT_APPLIED,
            mayReplan: outcome === Outcome.NOT_APPLIED,
            evidence: evidence ?? null
        });
    }

    async reconcile({
        expectedGeneration = null,
        getGeneration = null,
        cancellationToken = null,
        resourceKeys = [],
        owner = 'reconciliation',
        acquire = null,
        release = null,
        observeFresh,
        classify,
        maxFreshReads = this.maxFreshReads
    } = {}) {
        if (typeof observeFresh !== 'function') throw new TypeError('ReconciliationBarrier observeFresh is required.');
        if (typeof classify !== 'function') throw new TypeError('ReconciliationBarrier classify is required.');
        const keys = [...new Set((Array.isArray(resourceKeys) ? resourceKeys : [resourceKeys]).map(String).map(v => v.trim()).filter(Boolean))].sort();
        let lease = null;
        if (acquire) {
            lease = await acquire(keys, owner);
            if (!lease) return frozen({ outcome: Outcome.RESOURCE_BUSY, resolved: false, blocksMutation: true, mayReplan: false, attempts: 0, evidence: null });
        }
        try {
            const limit = Math.max(1, Math.min(32, Number(maxFreshReads) || this.maxFreshReads));
            let lastEvidence = null;
            for (let attempt = 1; attempt <= limit; attempt += 1) {
                if (cancellationToken?.isCancelled) return frozen({ outcome: Outcome.CANCELLED, resolved: false, blocksMutation: true, mayReplan: false, attempts: attempt - 1, evidence: lastEvidence });
                cancellationToken?.throwIfCancelled?.();
                const generation = typeof getGeneration === 'function' ? getGeneration() : expectedGeneration;
                if (expectedGeneration !== null && generation !== null && Number(expectedGeneration) !== Number(generation)) {
                    return frozen({ outcome: Outcome.STALE, resolved: false, blocksMutation: true, mayReplan: false, attempts: attempt - 1, evidence: lastEvidence });
                }
                lastEvidence = await observeFresh({ attempt, expectedGeneration, resourceKeys: keys });
                const classified = String(await classify(lastEvidence, { attempt, expectedGeneration, resourceKeys: keys }) || Outcome.UNRESOLVED).toUpperCase();
                if (classified === Outcome.APPLIED || classified === Outcome.NOT_APPLIED) {
                    return frozen({ outcome: classified, resolved: true, blocksMutation: classified !== Outcome.NOT_APPLIED, mayReplan: classified === Outcome.NOT_APPLIED, attempts: attempt, evidence: lastEvidence });
                }
                if (classified === Outcome.STALE || classified === Outcome.CANCELLED) {
                    return frozen({ outcome: classified, resolved: false, blocksMutation: true, mayReplan: false, attempts: attempt, evidence: lastEvidence });
                }
                if (attempt === 1 || attempt === limit) this.logger?.debug?.('RECONCILIATION BARRIER: fresh evidence unresolved.', { owner, attempt, limit, resourceKeys: keys });
            }
            return frozen({ outcome: Outcome.UNRESOLVED, resolved: false, blocksMutation: true, mayReplan: false, attempts: limit, evidence: lastEvidence });
        } finally {
            if (lease && release) await release(lease, keys, owner);
        }
    }
}

ReconciliationBarrier.Outcome = Outcome;
module.exports = ReconciliationBarrier;
