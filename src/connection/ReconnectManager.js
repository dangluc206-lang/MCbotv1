'use strict';

const DailyRecoverySchedule = require('../shared/time/DailyRecoverySchedule');

class ReconnectManager {
    constructor({ botId, connectionManager, eventBus, policy = {}, dailyRecovery = {}, attemptCoordinator = null, logger = null }) {
        this.botId = botId;
        this.connectionManager = connectionManager;
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
        this.running = false;
        this.unsubscribers = [];
    }

    async initialize() {
        if (!this.eventBus) return;

        this.unsubscribers.push(
            this.eventBus.on('connection:failed', event => {
                if (event.botId === this.botId) {
                    this.schedule(
                        event.error?.message || 'connection failed',
                        event.error?.details?.failureClass || event.diagnostic?.details?.failureClass || null
                    );
                }
            }),
            this.eventBus.on('connection:ended', event => {
                if (event.botId === this.botId && !event.intentional) {
                    this.schedule(event.reason || 'connection ended', null);
                }
            }),
            this.eventBus.on('connection:spawned', event => {
                if (event.botId !== this.botId) return;
                this.attempts = 0;
                this.#clearTimer();
            })
        );
    }

    async start() {
        this.running = true;
    }

    schedule(reason, failureClass = null) {
        if (!this.running || !this.policy.enabled) return false;
        if (this.attempts >= this.policy.maxAttempts) {
            this.logger?.error?.('Reconnect attempts exhausted.', {
                botId: this.botId,
                attempts: this.attempts,
                reason
            });
            this.eventBus?.emit('reconnect:exhausted', {
                botId: this.botId,
                attempts: this.attempts,
                reason
            });
            return false;
        }

        const plan = this.#planDelay(failureClass);
        const desiredDueAt = Date.now() + plan.delay;

        // `connection:ended` can arrive before the richer `connection:failed`
        // diagnostic. If the later diagnostic requires a longer cooldown, extend
        // the existing timer instead of keeping the too-short first schedule.
        if (this.timer) {
            if (desiredDueAt <= this.timerDueAt) return false;
            clearTimeout(this.timer);
            this.timer = null;
            this.logger?.warn?.('Minecraft reconnect cooldown extended.', {
                botId: this.botId,
                attempt: this.attempts + 1,
                delayMs: plan.delay,
                reason,
                failureClass,
                previousResumeAt: this.timerDueAt ? new Date(this.timerDueAt).toISOString() : null,
                resumeAt: new Date(desiredDueAt).toISOString()
            });
        } else {
            this.logger?.warn?.('Minecraft reconnect scheduled.', {
                botId: this.botId,
                attempt: this.attempts + 1,
                delayMs: plan.delay,
                reason,
                failureClass,
                dailyHold: plan.dailyHold,
                dailyWindow: plan.dailyHold ? plan.dailyState.start : null,
                resumeAt: plan.dailyHold ? plan.dailyState.resumeAt : new Date(desiredDueAt).toISOString()
            });
        }

        this.pendingReason = reason;
        this.pendingFailureClass = failureClass;
        this.timerDueAt = desiredDueAt;
        this.eventBus?.emit('reconnect:scheduled', {
            botId: this.botId,
            attempt: this.attempts + 1,
            delayMs: plan.delay,
            reason,
            failureClass,
            dailyHold: plan.dailyHold,
            dailyWindow: plan.dailyHold ? plan.dailyState.start : null,
            resumeAt: plan.dailyHold ? plan.dailyState.resumeAt : new Date(desiredDueAt).toISOString()
        });

        this.timer = setTimeout(() => this.#attemptReconnect(), plan.delay);
        this.timer.unref?.();
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
        if (!this.running) return;

        const reason = this.pendingReason || 'reconnect';
        this.pendingReason = null;
        this.pendingFailureClass = null;
        this.attempts += 1;
        this.eventBus?.emit('reconnect:attempting', {
            botId: this.botId,
            attempt: this.attempts
        });

        try {
            await this.connectionManager.connect();
            this.logger?.info?.('Minecraft reconnect succeeded.', {
                botId: this.botId,
                attempt: this.attempts
            });
            this.eventBus?.emit('reconnect:succeeded', {
                botId: this.botId,
                attempt: this.attempts
            });
            this.attempts = 0;
        } catch (error) {
            this.logger?.warn?.('Reconnect failed.', {
                botId: this.botId,
                attempt: this.attempts,
                reason,
                failureClass: error?.details?.failureClass || null,
                error
            });
            // ConnectionManager emits connection:failed. This fallback covers
            // custom managers/tests that do not emit it.
            if (!this.timer) this.schedule(error.message, error?.details?.failureClass || null);
        }
    }

    #clearTimer() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.timerDueAt = 0;
        this.pendingReason = null;
        this.pendingFailureClass = null;
    }

    async stop() {
        this.running = false;
        this.#clearTimer();
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    }

    async destroy() {
        await this.stop();
    }
}

module.exports = ReconnectManager;
