'use strict';

const DailyRecoverySchedule = require('../shared/time/DailyRecoverySchedule');
const { normalizeConnectionGeneration } = require('../core/events/EventEnvelope');
const ConnectionFailureSignalContract = require('./ConnectionFailureSignalContract');
const ConnectionSuccessResultContract = require('./ConnectionSuccessResultContract');

class ReconnectManager {
    constructor({ botId, connectionManager, context = null, eventBus, policy = {}, dailyRecovery = {}, attemptCoordinator = null, logger = null }) {
        this.botId = botId;
        this.connectionManager = connectionManager;
        this.context = context || connectionManager?.context || null;
        this.eventBus = eventBus;
        this.attemptCoordinator = attemptCoordinator;
        this.policy = {
            enabled: true,
            maxAttempts: Infinity,
            baseDelayMs: 5000,
            maxDelayMs: 60000,
            ...policy
        };
        this.logger = logger;
        this.dailyRecovery = new DailyRecoverySchedule(dailyRecovery);
        this.attempts = 0;
        this.timer = null;
        this.timerDueAt = 0;
        this.pendingReason = null;
        this.pendingFailureClass = null;
        this.pendingGeneration = null;
        this.pendingAttemptEpoch = null;
        this.pendingDecisionKey = null;
        this.latestAttemptEpoch = 0;
        this.running = false;
        this.suspended = false;
        this.unsubscribers = [];
        this.failureDecisions = new Map();
        this.fallbackFailureSequence = 0;
    }

    async initialize() {
        if (!this.eventBus) return;

        this.unsubscribers.push(
            this.eventBus.on('connection:attempt-started', event => {
                if (event?.botId !== this.botId || this.context?.has?.()) return;
                const attemptEpoch = this.#positiveInteger(event.attemptEpoch);
                if (attemptEpoch === null || attemptEpoch <= this.latestAttemptEpoch) return;
                this.latestAttemptEpoch = attemptEpoch;
            }),
            this.eventBus.on('connection:attempt-failed', event => {
                if (event?.botId !== this.botId) return;
                const attemptEpoch = this.#positiveInteger(event.attemptEpoch);
                if (!this.#isActionableAttempt(attemptEpoch)) return;
                if (!this.#isRetryable(event)) {
                    this.#markTerminalOwner(null, attemptEpoch);
                    return;
                }
                this.schedule(
                    event.error?.message || event.diagnostic?.message || 'connection attempt failed',
                    event.failureClass || event.error?.details?.failureClass || event.diagnostic?.details?.failureClass || null,
                    null,
                    attemptEpoch
                );
            }),
            this.eventBus.on('connection:failed', event => {
                if (event?.botId !== this.botId) return;
                const generation = normalizeConnectionGeneration(event);
                if (!this.#isActionableGeneration(generation)) return;
                if (!this.#isRetryable(event)) {
                    this.#markTerminalOwner(generation, null);
                    return;
                }
                this.schedule(
                    event.error?.message || 'connection failed',
                    event.error?.details?.failureClass || event.diagnostic?.details?.failureClass || null,
                    generation
                );
            }),
            this.eventBus.on('connection:ended', event => {
                const generation = normalizeConnectionGeneration(event);
                if (event?.botId === this.botId && !event.intentional && this.#isActionableGeneration(generation)) {
                    this.schedule(event.reason || 'connection ended', null, generation);
                }
            }),
            this.eventBus.on('connection:spawned', event => {
                if (event?.botId !== this.botId) return;
                const generation = normalizeConnectionGeneration(event);
                if (!this.#isCurrentGeneration(generation)) return;
                const attemptEpoch = this.#positiveInteger(event.attemptEpoch);
                if (attemptEpoch !== null) this.latestAttemptEpoch = Math.max(this.latestAttemptEpoch, attemptEpoch);
                this.attempts = 0;
                this.failureDecisions.clear();
                this.#clearTimer();
            })
        );
    }

    async start() {
        this.running = true;
    }

    schedule(reason, failureClass = null, sourceGeneration = null, sourceAttemptEpoch = null, { decisionKey = null } = {}) {
        if (!this.running || this.suspended || !this.policy.enabled) return false;

        const generation = this.#positiveInteger(sourceGeneration);
        const attemptEpoch = this.#positiveInteger(sourceAttemptEpoch);
        if (sourceGeneration != null && generation === null) return false;
        if (sourceAttemptEpoch != null && attemptEpoch === null) return false;
        if (generation !== null && !this.#isActionableGeneration(generation)) return false;
        if (attemptEpoch !== null && !this.#isActionableAttempt(attemptEpoch)) return false;

        const ownerDecisionKey = decisionKey || this.#ownerDecisionKey(generation, attemptEpoch);
        const existingDecision = ownerDecisionKey ? this.failureDecisions.get(ownerDecisionKey) : null;
        if (existingDecision) {
            if (existingDecision === 'scheduled' && this.timer && this.pendingDecisionKey === ownerDecisionKey) {
                this.#extendPendingSchedule(reason, failureClass);
            }
            return false;
        }

        // Attempt-owned and ownerless fallback work may never schedule over a
        // healthy current client. Generation-owned signals are validated above
        // and may still represent the exact current generation during event
        // ordering before its detach callback completes.
        if (this.context?.has?.() && generation === null) return false;

        if (this.attempts >= this.policy.maxAttempts) {
            if (ownerDecisionKey) this.#recordDecision(ownerDecisionKey, 'exhausted');
            this.logger?.error?.('Reconnect attempts exhausted.', {
                botId: this.botId,
                attempts: this.attempts,
                reason,
                sourceGeneration: generation,
                sourceAttemptEpoch: attemptEpoch
            });
            this.eventBus?.emit('reconnect:exhausted', {
                botId: this.botId,
                attempts: this.attempts,
                reason,
                sourceGeneration: generation,
                sourceAttemptEpoch: attemptEpoch
            });
            return false;
        }

        const plan = this.#planDelay(failureClass);
        const desiredDueAt = Date.now() + plan.delay;

        // A pending timer is already one reconnect decision. It may only be
        // replaced by a genuinely new owner. Equivalent signals from the same
        // physical failure are deduplicated by failureDecisions above.
        if (this.timer) {
            return false;
        }

        this.logger?.warn?.('Minecraft reconnect scheduled.', {
            botId: this.botId,
            attempt: this.attempts + 1,
            delayMs: plan.delay,
            reason,
            failureClass,
            dailyHold: plan.dailyHold,
            dailyWindow: plan.dailyHold ? plan.dailyState.start : null,
            resumeAt: plan.dailyHold ? plan.dailyState.resumeAt : new Date(desiredDueAt).toISOString(),
            sourceGeneration: generation,
            sourceAttemptEpoch: attemptEpoch
        });

        if (ownerDecisionKey) this.#recordDecision(ownerDecisionKey, 'scheduled');
        this.pendingReason = reason;
        this.pendingFailureClass = failureClass;
        this.pendingGeneration = generation;
        this.pendingAttemptEpoch = attemptEpoch;
        this.pendingDecisionKey = ownerDecisionKey;
        this.timerDueAt = desiredDueAt;
        this.eventBus?.emit('reconnect:scheduled', {
            botId: this.botId,
            attempt: this.attempts + 1,
            delayMs: plan.delay,
            reason,
            failureClass,
            sourceGeneration: generation,
            sourceAttemptEpoch: attemptEpoch,
            dailyHold: plan.dailyHold,
            dailyWindow: plan.dailyHold ? plan.dailyState.start : null,
            resumeAt: plan.dailyHold ? plan.dailyState.resumeAt : new Date(desiredDueAt).toISOString()
        });

        this.timer = setTimeout(() => this.#attemptReconnect(), plan.delay);
        this.timer.unref?.();
        return true;
    }

    #extendPendingSchedule(reason, failureClass) {
        const plan = this.#planDelay(failureClass);
        const desiredDueAt = Date.now() + plan.delay;
        if (!this.timer || desiredDueAt <= this.timerDueAt) return false;
        clearTimeout(this.timer);
        this.pendingReason = reason;
        this.pendingFailureClass = failureClass;
        this.timerDueAt = desiredDueAt;
        const remainingMs = Math.max(0, desiredDueAt - Date.now());
        this.timer = setTimeout(() => this.#attemptReconnect(), remainingMs);
        this.timer.unref?.();
        this.logger?.warn?.('Minecraft reconnect cooldown extended without creating a second reconnect decision.', {
            botId: this.botId,
            attempt: this.attempts + 1,
            delayMs: remainingMs,
            reason,
            failureClass,
            sourceGeneration: this.pendingGeneration,
            sourceAttemptEpoch: this.pendingAttemptEpoch,
            resumeAt: new Date(desiredDueAt).toISOString()
        });
        return true;
    }

    #planDelay(failureClass) {
        const normalDelay = Math.min(
            this.policy.baseDelayMs * (2 ** this.attempts),
            this.policy.maxDelayMs
        );
        const failureFloor = this.attemptCoordinator?.cooldownForFailure
            ? this.attemptCoordinator.cooldownForFailure(failureClass)
            : 0;
        const dailyState = this.dailyRecovery.state('server');
        const scheduledDelay = this.dailyRecovery.reconnectDelay();
        const delay = Math.max(normalDelay, failureFloor, scheduledDelay);
        return {
            delay,
            dailyState,
            dailyHold: scheduledDelay > Math.max(normalDelay, failureFloor)
        };
    }

    async #attemptReconnect() {
        this.timer = null;
        this.timerDueAt = 0;
        if (!this.running || this.suspended) return;

        const reason = this.pendingReason || 'reconnect';
        const sourceGeneration = this.pendingGeneration;
        const sourceAttemptEpoch = this.pendingAttemptEpoch;
        this.pendingReason = null;
        this.pendingFailureClass = null;
        this.pendingGeneration = null;
        this.pendingAttemptEpoch = null;
        this.pendingDecisionKey = null;

        if (sourceGeneration !== null && !this.#isActionableGeneration(sourceGeneration)) return;
        if (sourceAttemptEpoch !== null && !this.#isActionableAttempt(sourceAttemptEpoch)) return;
        if (this.context?.has?.()) return;

        this.attempts += 1;
        const reconnectAttempt = this.attempts;
        this.eventBus?.emit('reconnect:attempting', {
            botId: this.botId,
            attempt: reconnectAttempt,
            sourceGeneration,
            sourceAttemptEpoch
        });

        try {
            const connectOutcome = typeof this.connectionManager?.connectWithResult === 'function'
                ? { explicit: true, value: await this.connectionManager.connectWithResult() }
                : { explicit: false, value: await this.connectionManager.connect() };
            if (!this.running || this.suspended) return;
            const success = this.#validateSuccessOutcome(connectOutcome);
            if (!success) return;

            this.logger?.info?.('Minecraft reconnect succeeded.', {
                botId: this.botId,
                attempt: reconnectAttempt,
                sourceGeneration,
                sourceAttemptEpoch,
                connectionGeneration: success.connectionGeneration,
                successfulAttemptId: success.successfulAttemptId,
                successfulAttemptEpoch: success.successfulAttemptEpoch
            });
            this.eventBus?.emit('reconnect:succeeded', {
                botId: this.botId,
                attempt: reconnectAttempt,
                sourceGeneration,
                sourceAttemptEpoch,
                connectionGeneration: success.connectionGeneration,
                resultGeneration: success.connectionGeneration,
                successfulAttemptId: success.successfulAttemptId,
                successfulAttemptEpoch: success.successfulAttemptEpoch
            });
            this.attempts = 0;
            this.failureDecisions.clear();
        } catch (error) {
            this.logger?.warn?.('Reconnect failed.', {
                botId: this.botId,
                attempt: this.attempts,
                reason,
                failureClass: error?.details?.failureClass || null,
                error
            });

            if (!this.running || this.suspended || this.context?.has?.()) return;

            // Production ConnectionManager marks errors whose canonical failure
            // event was already emitted synchronously before connect() rejects.
            // That event is the single authoritative reconnect decision source;
            // never infer a second decision from currentAttempt/timer timing.
            if (error?.details?.failureSignal?.contract === ConnectionFailureSignalContract.contract) return;

            // Explicit fallback exists only for injected/custom managers that do
            // not publish the canonical failure signal contract.
            if (error?.retryable === false || error?.details?.retryable === false) return;

            const errorGeneration = this.#positiveInteger(error?.details?.connectionGeneration);
            const errorAttemptEpoch = this.#positiveInteger(error?.details?.attemptEpoch);
            const fallbackGeneration = errorGeneration ?? sourceGeneration;
            const fallbackAttemptEpoch = errorAttemptEpoch ?? sourceAttemptEpoch;
            if (fallbackGeneration !== null && !this.#isActionableGeneration(fallbackGeneration)) return;
            if (fallbackAttemptEpoch !== null && !this.#isActionableAttempt(fallbackAttemptEpoch)) return;
            if (this.context?.has?.()) return;

            this.schedule(
                error?.message || 'reconnect failed',
                error?.details?.failureClass || null,
                fallbackGeneration,
                fallbackAttemptEpoch,
                { decisionKey: `fallback:${++this.fallbackFailureSequence}` }
            );
        }
    }

    #validateSuccessOutcome({ explicit, value }) {
        if (!this.running) return null;

        if (!this.context) {
            const legacyResult = explicit ? value?.client : value;
            if (!legacyResult) return null;
            if (explicit && !ConnectionSuccessResultContract.is(value)) return null;
            return Object.freeze({
                connectionGeneration: explicit ? this.#positiveInteger(value.connectionGeneration) : null,
                successfulAttemptId: explicit && typeof value.attemptId === 'string' ? value.attemptId : null,
                successfulAttemptEpoch: explicit ? this.#positiveInteger(value.attemptEpoch) : null
            });
        }

        if (!explicit || !ConnectionSuccessResultContract.is(value)) return null;
        const startedByInvocation = value.startedByInvocation === true;
        const joinedInFlight = value.joinedInFlight === true;
        // A reconnect invocation may either start the successful attempt or join
        // the one exact attempt already in flight. Merely observing an existing
        // replacement client is not reconnect success ownership.
        if ((!startedByInvocation && !joinedInFlight)
            || (startedByInvocation && (joinedInFlight || value.joinedExisting === true))) return null;
        if (!value.client || value.client !== this.context.get()) return null;
        const connectionGeneration = this.#positiveInteger(value.connectionGeneration);
        if (connectionGeneration === null || Number(this.context.getGeneration()) !== connectionGeneration) return null;
        const successfulAttemptEpoch = this.#positiveInteger(value.attemptEpoch);
        const successfulAttemptId = typeof value.attemptId === 'string' && value.attemptId.trim()
            ? value.attemptId
            : null;
        if (successfulAttemptEpoch === null || successfulAttemptId === null) return null;

        return Object.freeze({
            connectionGeneration,
            successfulAttemptId,
            successfulAttemptEpoch
        });
    }

    #isRetryable(event) {
        return event?.retryable !== false
            && event?.error?.retryable !== false
            && event?.diagnostic?.retryable !== false;
    }

    #ownerDecisionKey(sourceGeneration, sourceAttemptEpoch) {
        if (Number.isInteger(sourceAttemptEpoch) && sourceAttemptEpoch > 0) return `attempt:${sourceAttemptEpoch}`;
        if (Number.isInteger(sourceGeneration) && sourceGeneration > 0) return `generation:${sourceGeneration}`;
        return null;
    }

    #recordDecision(key, outcome) {
        if (!key) return;
        this.failureDecisions.set(key, outcome);
        // Attempts/generations are monotonic; retain only a bounded recent ledger.
        while (this.failureDecisions.size > 128) {
            const oldest = this.failureDecisions.keys().next().value;
            this.failureDecisions.delete(oldest);
        }
    }

    #markTerminalOwner(sourceGeneration, sourceAttemptEpoch) {
        const key = this.#ownerDecisionKey(sourceGeneration, sourceAttemptEpoch);
        if (key && this.pendingDecisionKey === key) this.#clearTimer();
        if (key) this.#recordDecision(key, 'terminal');
    }

    #positiveInteger(value) {
        if (value === null || value === undefined) return null;
        const number = Number(value);
        return Number.isInteger(number) && number > 0 ? number : null;
    }

    #isActionableAttempt(attemptEpoch) {
        if (!Number.isInteger(attemptEpoch) || attemptEpoch <= 0) return false;
        if (this.context?.has?.()) return false;
        return this.latestAttemptEpoch === attemptEpoch;
    }

    #isCurrentGeneration(generation) {
        return Number.isInteger(generation)
            && generation > 0
            && this.context?.has?.()
            && Number(this.context.getGeneration()) === generation;
    }

    #isActionableGeneration(generation) {
        if (!Number.isInteger(generation) || generation <= 0) return false;
        if (!this.context) return true;
        return Number(this.context.getGeneration?.()) === generation;
    }

    #clearTimer() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.timerDueAt = 0;
        this.pendingReason = null;
        this.pendingFailureClass = null;
        this.pendingGeneration = null;
        this.pendingAttemptEpoch = null;
        this.pendingDecisionKey = null;
    }


    cancelPending(reason = 'Reconnect cancelled by operator.') {
        const hadPending = Boolean(this.timer || this.pendingDecisionKey || this.pendingGeneration || this.pendingAttemptEpoch);
        this.#clearTimer();
        this.failureDecisions.clear();
        this.attempts = 0;
        if (hadPending) {
            this.logger?.info?.('Pending reconnect cancelled.', {
                botId: this.botId,
                reason
            });
            this.eventBus?.emit('reconnect:cancelled', {
                botId: this.botId,
                reason
            });
        }
        return hadPending;
    }

    suspend(reason = 'Automatic reconnect suspended by operator.') {
        const changed = !this.suspended;
        this.suspended = true;
        const cancelled = this.cancelPending(reason);
        if (changed) {
            this.logger?.info?.('Automatic reconnect suspended.', { botId: this.botId, reason });
            this.eventBus?.emit('reconnect:suspended', { botId: this.botId, reason });
        }
        return changed || cancelled;
    }

    resume(reason = 'Automatic reconnect resumed by operator.') {
        const changed = this.suspended;
        this.suspended = false;
        if (changed) {
            this.logger?.info?.('Automatic reconnect resumed.', { botId: this.botId, reason });
            this.eventBus?.emit('reconnect:resumed', { botId: this.botId, reason });
        }
        return changed;
    }

    async stop() {
        this.running = false;
        this.#clearTimer();
        this.failureDecisions.clear();
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    }

    async destroy() {
        await this.stop();
    }
}

module.exports = ReconnectManager;
