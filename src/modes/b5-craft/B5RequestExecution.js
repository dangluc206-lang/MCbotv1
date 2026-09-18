'use strict';

/**
 * Request-level orchestration seam for B5CraftModeService (Task 5).
 *
 * Pure counting/decision logic: it never clicks a GUI, never crafts, never
 * reads /kho or /pv 2, never computes recipes and never imports Mineflayer.
 * Each cycle is a bounded "one unit" request that the mode executes through
 * B5AutomationService.runTarget(); unit completion is only credited from
 * verified cycle results (completedNewB5 for the request target).
 *
 * Loop guards:
 * - FIXED stops exactly at `quantity` verified units (no unbounded loop).
 * - ALL never becomes Infinity; it continues only while cycles make verified
 *   or productive progress and stops on the injected guards below.
 */

const STATES = Object.freeze(['PENDING', 'RUNNING', 'COMPLETED', 'EXHAUSTED', 'BLOCKED', 'FAILED']);
const DEFAULTS = Object.freeze({
    maxCyclesWithoutTargetUnit: 12,
    maxBlockedStreakForAll: 3
});

class B5RequestExecution {
    constructor({ request, maxCyclesWithoutTargetUnit = DEFAULTS.maxCyclesWithoutTargetUnit, maxBlockedStreakForAll = DEFAULTS.maxBlockedStreakForAll } = {}) {
        if (!request?.targetItemId) throw new TypeError('B5RequestExecution requires a CraftingRequest.');
        this.request = request;
        this.targetItemId = request.targetItemId;
        this.quantityMode = request.quantityMode;
        if (![maxCyclesWithoutTargetUnit, maxBlockedStreakForAll].every(value => Number.isSafeInteger(value) && value > 0)) {
            throw new TypeError('Request guard limits must be positive safe integers.');
        }
        if (!['FIXED', 'ALL'].includes(request.quantityMode)
            || (request.quantityMode === 'FIXED' && (!Number.isSafeInteger(request.quantity) || request.quantity <= 0))) {
            throw new TypeError('Request quantity must be a positive safe integer or ALL.');
        }
        this.maxCyclesWithoutTargetUnit = maxCyclesWithoutTargetUnit;
        this.maxBlockedStreakForAll = maxBlockedStreakForAll;
        this.#reset();
    }

    #reset() {
        this.state = 'PENDING';
        this.completedUnits = 0;
        this.cycles = 0;
        this.productiveCycles = 0;
        this.blockedStreak = 0;
        this.cyclesSinceTargetUnit = 0;
        this.transientFailures = 0;
        this.lastBlocker = null;
        this.lastError = null;
        this.awaitingReconciliation = false;
        this.lastRecord = null;
    }

    get quantity() { return this.quantityMode === 'ALL' ? null : Number(this.request.quantity); }

    remaining() {
        if (this.quantityMode === 'ALL') return null; // ALL is a mode, never Infinity
        return Math.max(0, this.quantity - this.completedUnits);
    }

    isTerminal() { return ['COMPLETED', 'EXHAUSTED', 'FAILED'].includes(this.state); }

    nextCycle() {
        if (this.isTerminal()) return this.#stop(this.state, this.lastError || this.lastBlocker);
        if (this.awaitingReconciliation) return Object.freeze({ action: 'WAIT', reason: 'awaiting-reconciliation' });
        if (this.quantityMode === 'FIXED' && this.completedUnits >= this.quantity) {
            this.state = 'COMPLETED';
            return this.#stop('COMPLETED', null);
        }
        this.state = 'RUNNING';
        return Object.freeze({ action: 'CYCLE', targetId: this.targetItemId, amount: 1 });
    }

    /**
     * Credit only verified evidence. Stale results (generation mismatch) are
     * ignored entirely; the mode owns its generation guard, this is the second
     * wall at the request layer.
     */
    record(result, { generation = null, expectedGeneration = null } = {}) {
        if (generation != null && expectedGeneration != null && Number(generation) !== Number(expectedGeneration)) {
            return Object.freeze({ ignored: 'stale-generation', state: this.state });
        }
        if (this.isTerminal()) return Object.freeze({ ignored: 'terminal', state: this.state });
        if (this.awaitingReconciliation) return Object.freeze({ ignored: 'awaiting-reconciliation', state: this.state });

        const data = result?.data || {};
        this.cycles += 1;
        this.cyclesSinceTargetUnit += 1;
        this.awaitingReconciliation = false;

        if (result?.meta?.requiresReconciliation === true || data.requiresReconciliation === true
            || result?.error?.details?.outcome?.requiresReconciliation === true) {
            this.awaitingReconciliation = true;
            this.lastError = 'awaiting-reconciliation';
            return this.snapshot();
        }
        if (result?.success === false) {
            return this.#recordFailure(result, data);
        }

        const targetMatch = String(data.targetId || '') === this.targetItemId;
        if (data.completedNewB5 === true) {
            if (result?.success !== true || !targetMatch || data.completedAmount !== 1) {
                this.state = 'FAILED';
                this.lastError = 'invalid-target-completion-evidence';
                return this.snapshot();
            }
            this.completedUnits += 1;
            this.blockedStreak = 0;
            this.cyclesSinceTargetUnit = 0;
            this.lastBlocker = null;
            if (this.quantityMode === 'FIXED' && this.completedUnits >= this.quantity) this.state = 'COMPLETED';
        } else if (data.productive === true) {
            this.productiveCycles += 1;
            this.blockedStreak = 0;
        } else {
            this.blockedStreak += 1;
            this.lastBlocker = this.#blockerOf(data);
            if (result?.success === true && data.waitingForMaterials === true && this.quantityMode === 'ALL') {
                this.state = 'EXHAUSTED';
                this.lastError = this.lastBlocker;
            }
        }

        this.lastRecord = { cycles: this.cycles, completedUnits: this.completedUnits, blockedStreak: this.blockedStreak };
        this.#applyGuards();
        return this.snapshot();
    }

    // Called only after the mode's existing fresh-state/provenance verification.
    resolveReconciliation({ verified = false, generation = null, expectedGeneration = null, targetId = null, completedAmount = 0 } = {}) {
        if (!this.awaitingReconciliation || verified !== true || generation === null || expectedGeneration === null
            || generation !== expectedGeneration || this.isTerminal()) return this.snapshot();
        if (completedAmount !== 0 && (completedAmount !== 1 || targetId !== this.targetItemId)) return this.snapshot();
        this.awaitingReconciliation = false;
        if (completedAmount === 1) {
            return this.record({ success: true, data: { targetId, completedNewB5: true, completedAmount } }, { generation, expectedGeneration });
        }
        this.#applyGuards();
        return this.snapshot();
    }

    #applyGuards() {
        if (this.isTerminal()) return;
        if (this.blockedStreak >= this.maxBlockedStreakForAll) {
            this.state = 'EXHAUSTED';
            this.lastError = this.lastBlocker || 'blocked-without-progress';
        } else if (this.cyclesSinceTargetUnit >= this.maxCyclesWithoutTargetUnit) {
            this.state = 'EXHAUSTED';
            this.lastError = 'cycles-without-target-unit';
        }
    }

    #recordFailure(result, data) {
        const code = String(result?.error?.code || result?.errorCode || data?.errorCode || '');
        if (result?.status === 'CANCELLED') {
            this.state = 'BLOCKED';
            this.lastError = 'cancelled';
            return this.snapshot();
        }
        if (result?.meta?.requiresReconciliation === true || data.requiresReconciliation === true) {
            this.awaitingReconciliation = true;
            this.lastError = code || 'awaiting-reconciliation';
            return this.snapshot();
        }
        if (['TIMEOUT', 'DISCONNECTED', 'NOT_READY', 'VERIFICATION_FAILED'].includes(String(result?.status || '')) || code.startsWith('TIMEOUT_')) {
            this.transientFailures += 1;
            this.blockedStreak += 1;
            this.lastBlocker = code || result?.message || 'transient-failure';
            this.#applyGuards();
            return this.snapshot();
        }
        this.state = 'FAILED';
        this.lastError = code || result?.message || 'B5 request cycle failed';
        return this.snapshot();
    }

    #blockerOf(data) {
        return data.blockingReasons?.[0]
            || (data.waitingForMaterials ? 'waiting-for-materials' : null)
            || (data.pv2Backpressure?.hardBlocked ? 'pv2-hard-backpressure' : null)
            || 'no-progress';
    }

    #stop(state, reason) {
        return Object.freeze({
            action: 'STOP', state,
            targetId: this.targetItemId,
            reason: reason || null,
            completedUnits: this.completedUnits,
            quantity: this.quantity
        });
    }

    snapshot() {
        return Object.freeze({
            targetItemId: this.targetItemId,
            targetDisplayName: this.request.targetDisplayName || null,
            quantityMode: this.quantityMode,
            quantity: this.quantity,
            state: this.state,
            isTerminal: this.isTerminal(),
            remaining: this.remaining(),
            completedUnits: this.completedUnits,
            cycles: this.cycles,
            productiveCycles: this.productiveCycles,
            blockedStreak: this.blockedStreak,
            cyclesSinceTargetUnit: this.cyclesSinceTargetUnit,
            transientFailures: this.transientFailures,
            awaitingReconciliation: this.awaitingReconciliation,
            lastBlocker: this.lastBlocker,
            lastError: this.lastError
        });
    }
}

B5RequestExecution.STATES = STATES;
B5RequestExecution.DEFAULTS = DEFAULTS;
module.exports = B5RequestExecution;
