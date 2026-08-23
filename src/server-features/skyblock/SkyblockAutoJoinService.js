'use strict';

const CancellationSource = require('../../shared/cancellation/CancellationSource');
const DailyRecoverySchedule = require('../../shared/time/DailyRecoverySchedule');
const { normalizeConnectionGeneration } = require('../../core/events/EventEnvelope');

/**
 * Demand-driven Sky gateway. A login/spawn by itself never enters Sky. Modes
 * acquire a target (sky1, sky2, skyOP, ...); while that demand exists the
 * gateway keeps the bot in that target and retries without an attempt limit.
 */
class SkyblockAutoJoinService {
    constructor({ botId, context = null, eventBus, skyblock, config = {}, dailyRecovery = {}, logger = null }) {
        if (typeof botId !== 'string' || !botId.trim()) throw new TypeError('botId must be a non-empty string');
        if (!eventBus || typeof eventBus.on !== 'function') throw new TypeError('eventBus is required');
        if (!skyblock || typeof skyblock.join !== 'function') throw new TypeError('skyblock service with join() is required');
        this.name = 'SkyblockAutoJoinService';
        Object.assign(this, { botId, context, eventBus, skyblock, logger });
        this.config = this.#normalizeConfig(config);
        this.dailyRecovery = new DailyRecoverySchedule(dailyRecovery);
        this.initialized = false;
        this.unsubscribers = [];
        this.pending = null;
        this.resourcePackReadyGenerations = new Set();
        this.deferredSchedules = new Map();
        this.manualHubHoldGenerations = new Set();
        this.demands = new Map();
        this.location = 'UNKNOWN';
        this.readyGeneration = null;
        this.readyTarget = null;
        this.dailySkyRecoveryDate = null;
        this.recoveryPollTimer = null;
    }

    async initialize() {
        if (this.initialized) return;
        this.initialized = true;
        this.logger?.debug?.('Sky mode gateway initialized.', {
            botId: this.botId,
            defaultTarget: this.config.selection,
            retryDelayMs: this.config.retryDelayMs,
            waitForResourcePack: this.config.waitForResourcePack
        });
        this.recoveryPollTimer = setInterval(() => this.#pollDailySkyRecovery(), this.config.recoveryPollMs);
        this.recoveryPollTimer.unref?.();

        const onHubBoundary = (event, delayMs, trigger) => {
            if (event.botId !== this.botId) return;
            const generation = normalizeConnectionGeneration(event);
            if (!this.#isCurrentGeneration(generation)) return;
            const returnedFromSky = this.readyGeneration === generation;
            this.#markHub(generation);
            if (!this.#desiredTarget()) return;
            this.#requestSchedule(generation, returnedFromSky ? this.config.rejoinDelayMs : delayMs, 1, returnedFromSky ? `${trigger}-after-sky` : trigger, { replace: true });
        };

        this.unsubscribers.push(
            this.eventBus.on('connection:spawned', event => onHubBoundary(event, this.config.spawnFallbackDelayMs, 'connection:spawned')),
            this.eventBus.on('server-login:succeeded', event => onHubBoundary(event, this.config.delayMs, 'server-login:succeeded')),
            this.eventBus.on('server-login:disabled', event => onHubBoundary(event, this.config.delayMs, 'server-login:disabled')),
            this.eventBus.on('resource-pack:ready', event => {
                if (event.botId !== this.botId) return;
                const generation = normalizeConnectionGeneration(event);
                if (!this.#isCurrentGeneration(generation)) return;
                this.resourcePackReadyGenerations.add(generation);
                const deferred = this.deferredSchedules.get(generation);
                if (!deferred || !this.#desiredTarget()) return;
                this.deferredSchedules.delete(generation);
                this.#schedule(generation, deferred.delayMs, deferred.attempt, `${deferred.trigger}+resource-pack:ready`, { replace: deferred.replace });
            }),
            this.eventBus.on('server-login:failed', event => {
                if (event.botId !== this.botId) return;
                const generation = normalizeConnectionGeneration(event);
                if (this.pending?.generation === generation) this.#cancelPending('Server login failed.');
            }),
            this.eventBus.on('connection:login', event => {
                if (event.botId !== this.botId) return;
                const generation = normalizeConnectionGeneration(event);
                if (!this.#isCurrentGeneration(generation)) return;
                if (this.readyGeneration !== generation) return;
                this.#markHub(generation);
                if (this.#desiredTarget()) this.#requestSchedule(generation, this.config.rejoinDelayMs, 1, 'connection:login-after-sky', { replace: true });
            }),
            this.eventBus.on('connection:ended', event => {
                if (event.botId !== this.botId) return;
                const generation = normalizeConnectionGeneration(event);
                if (!Number.isInteger(generation) || generation <= 0) return;
                if (this.pending?.generation === generation) this.#cancelPending('Minecraft connection ended.');
                this.resourcePackReadyGenerations.delete(generation);
                this.deferredSchedules.delete(generation);
                this.manualHubHoldGenerations.delete(generation);
                if (this.readyGeneration === generation) {
                    this.readyGeneration = null;
                    this.readyTarget = null;
                }
                this.location = 'UNKNOWN';
            })
        );
    }

    async stop() {
        this.#cancelPending('Sky mode gateway stopped.');
        if (this.recoveryPollTimer) clearInterval(this.recoveryPollTimer);
        this.recoveryPollTimer = null;
        for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
        this.resourcePackReadyGenerations.clear();
        this.deferredSchedules.clear();
        this.manualHubHoldGenerations.clear();
        this.demands.clear();
        this.location = 'UNKNOWN';
        this.readyGeneration = null;
        this.readyTarget = null;
        this.dailySkyRecoveryDate = null;
        this.initialized = false;
    }

    async destroy() { await this.stop(); }

    requireTarget(target = null, { owner = 'mode', trigger = 'mode-demand' } = {}) {
        const resolvedTarget = String(target || this.config.selection || '').trim();
        if (!resolvedTarget) throw new TypeError('Sky target must be a non-empty string.');
        const ownerId = String(owner || 'mode').trim();
        this.demands.set(ownerId, resolvedTarget);
        const distinctTargets = new Set(this.demands.values());
        if (distinctTargets.size > 1) {
            this.demands.delete(ownerId);
            const error = new Error(`Conflicting Sky targets requested: ${[...distinctTargets].join(', ')}`);
            error.code = 'SKY_TARGET_CONFLICT';
            throw error;
        }
        if (this.readyTarget && this.readyTarget !== resolvedTarget) {
            this.readyGeneration = null;
            this.readyTarget = null;
            this.location = 'HUB';
        }
        const generation = Number(this.context?.getGeneration?.() || 0);
        if (this.#isCurrentGeneration(generation) && !this.isGenerationReady(generation, resolvedTarget)) {
            this.#requestSchedule(generation, 0, 1, trigger, { replace: true });
        }
        return this.status();
    }

    releaseTarget(owner = 'mode') {
        const ownerId = typeof owner === 'object' ? String(owner.owner || 'mode') : String(owner || 'mode');
        this.demands.delete(ownerId);
        if (!this.#desiredTarget()) {
            this.#cancelPending('No active mode requires Sky.');
            this.deferredSchedules.clear();
        }
        return this.status();
    }

    isGenerationReady(generation, target = null) {
        const normalized = Number(generation);
        const desired = String(target || this.#desiredTarget() || this.config.selection || '').trim();
        return Number.isInteger(normalized) && normalized > 0
            && this.location === 'SKY'
            && this.readyGeneration === normalized
            && (!desired || this.readyTarget === desired);
    }

    status() {
        const generation = Number(this.context?.getGeneration?.() || 0) || null;
        const target = this.#desiredTarget();
        return {
            target,
            defaultTarget: this.config.selection,
            location: this.location,
            generation,
            ready: generation ? this.isGenerationReady(generation, target) : false,
            readyTarget: this.readyTarget,
            demandOwners: Object.fromEntries(this.demands),
            manualHubHold: generation ? this.manualHubHoldGenerations.has(generation) : false,
            pending: this.pending ? { generation: this.pending.generation, target: this.pending.target, attempt: this.pending.attempt, trigger: this.pending.trigger, scheduled: Boolean(this.pending.timer) } : null,
            config: { ...this.config }
        };
    }

    requestJoinNow({ trigger = 'manual-remote', target = null } = {}) {
        const resolvedTarget = String(target || this.#desiredTarget() || this.config.selection || '').trim();
        this.requireTarget(resolvedTarget, { owner: 'manual-remote', trigger });
        const generation = Number(this.context?.getGeneration?.() || 0);
        if (!this.#isCurrentGeneration(generation)) {
            const error = new Error('Bot is not connected; cannot enter Sky.');
            error.code = 'SKYBLOCK_NOT_CONNECTED';
            throw error;
        }
        this.manualHubHoldGenerations.delete(generation);
        this.#markHub(generation);
        this.#requestSchedule(generation, 0, 1, trigger, { replace: true });
        return this.status();
    }

    holdAtHub({ reason = 'manual-remote-hub' } = {}) {
        const generation = Number(this.context?.getGeneration?.() || 0);
        if (!this.#isCurrentGeneration(generation)) {
            const error = new Error('Bot is not connected; cannot hold at HUB.');
            error.code = 'SKYBLOCK_NOT_CONNECTED';
            throw error;
        }
        this.manualHubHoldGenerations.add(generation);
        this.#markHub(generation);
        this.#cancelPending(`Sky gateway held at HUB: ${reason}`);
        return this.status();
    }

    releaseHubHold({ rejoin = false, trigger = 'manual-hub-hold-release' } = {}) {
        const generation = Number(this.context?.getGeneration?.() || 0);
        if (!Number.isInteger(generation) || generation <= 0) return this.status();
        this.manualHubHoldGenerations.delete(generation);
        if (rejoin && this.#desiredTarget() && this.#isCurrentGeneration(generation)) {
            this.#requestSchedule(generation, 0, 1, trigger, { replace: true });
        }
        return this.status();
    }

    reconfigure(config = {}) {
        this.config = this.#normalizeConfig(config);
        const generation = Number(this.context?.getGeneration?.() || 0);
        if (this.#desiredTarget() && this.#isCurrentGeneration(generation) && !this.isGenerationReady(generation)) {
            this.#requestSchedule(generation, 0, 1, 'reconfigure', { replace: true });
        }
        return this.status();
    }

    #desiredTarget() {
        const first = this.demands.values().next();
        return first.done ? null : first.value;
    }

    #markHub(generation) {
        if (this.readyGeneration === generation) {
            this.readyGeneration = null;
            this.readyTarget = null;
        }
        this.location = 'HUB';
    }

    #requestSchedule(generation, delayMs, attempt, trigger, { replace = false } = {}) {
        const target = this.#desiredTarget();
        if (!target || !this.#isCurrentGeneration(generation) || this.manualHubHoldGenerations.has(generation)) return;
        const dailyState = this.dailyRecovery.state('sky');
        const effectiveDelayMs = dailyState.active ? Math.max(delayMs, dailyState.waitMs) : delayMs;
        if (!this.config.waitForResourcePack || this.resourcePackReadyGenerations.has(generation)) {
            this.#schedule(generation, effectiveDelayMs, attempt, trigger, { replace });
            return;
        }
        if (this.deferredSchedules.has(generation) && !replace) return;
        this.deferredSchedules.set(generation, { delayMs: effectiveDelayMs, attempt, trigger, replace, target });
    }

    #schedule(generation, delayMs, attempt, trigger, { replace = false } = {}) {
        const target = this.#desiredTarget();
        if (!target || !this.#isCurrentGeneration(generation) || this.manualHubHoldGenerations.has(generation)) return;
        if (this.isGenerationReady(generation, target)) return;
        if (this.pending?.generation === generation) {
            if (!replace && this.pending.target === target) return;
            this.#cancelPending(`Sky gateway rescheduled by ${trigger}.`);
        } else if (this.pending) {
            this.#cancelPending('A newer Sky join was scheduled.');
        }
        const cancellationSource = new CancellationSource();
        const pending = { generation, target, attempt, trigger, cancellationSource, timer: null };
        this.pending = pending;
        this.eventBus.emit('skyblock:gateway:scheduled', { botId: this.botId, connectionGeneration: generation, selectionId: target, attempt, trigger, delayMs });
        pending.timer = setTimeout(() => { pending.timer = null; void this.#run(pending); }, delayMs);
        pending.timer.unref?.();
    }

    async #run(pending) {
        if (this.pending !== pending || pending.cancellationSource.token.isCancelled) return;
        const { generation, target, attempt, trigger, cancellationSource } = pending;
        if (!this.#isCurrentGeneration(generation) || this.#desiredTarget() !== target || this.manualHubHoldGenerations.has(generation)) {
            this.#clearPending(pending);
            return;
        }
        this.eventBus.emit('skyblock:gateway:attempting', { botId: this.botId, connectionGeneration: generation, selectionId: target, attempt, trigger });
        try {
            const result = await this.skyblock.join(target, { cancellationToken: cancellationSource.token, expectedGeneration: generation });
            if (this.pending !== pending || cancellationSource.token.isCancelled) return;
            if (!this.#isCurrentGeneration(generation) || this.#desiredTarget() !== target) {
                this.#clearPending(pending);
                return;
            }
            if (result?.success) {
                this.readyGeneration = generation;
                this.readyTarget = target;
                this.location = 'SKY';
                this.eventBus.emit('skyblock:gateway:succeeded', { botId: this.botId, connectionGeneration: generation, selectionId: target, attempt, trigger, result: result.data || null });
                this.#clearPending(pending);
                return;
            }
            await this.#handleFailure(pending, result?.error || new Error(result?.message || 'Sky join failed.'));
        } catch (error) {
            if (!cancellationSource.token.isCancelled) await this.#handleFailure(pending, error);
        }
    }

    async #handleFailure(pending, error) {
        if (this.pending !== pending) return;
        const { generation, target, attempt, trigger } = pending;
        this.logger?.info?.('Sky mode gateway join failed; retry remains scheduled while mode demand exists.', {
            botId: this.botId, connectionGeneration: generation, target, attempt, trigger,
            error: { code: error?.code || null, message: error?.message || String(error) }
        });
        this.eventBus.emit('skyblock:gateway:failed', { botId: this.botId, connectionGeneration: generation, selectionId: target, attempt, trigger, final: false, error });
        this.#clearPending(pending);
        if (this.#desiredTarget() === target) this.#requestSchedule(generation, this.config.retryDelayMs, attempt + 1, 'retry', { replace: false });
    }

    #pollDailySkyRecovery() {
        const target = this.#desiredTarget();
        if (!target) return;
        const generation = Number(this.context?.getGeneration?.() || 0);
        if (!this.#isCurrentGeneration(generation) || this.manualHubHoldGenerations.has(generation)) return;
        const state = this.dailyRecovery.state('sky');
        if (state.active && this.dailySkyRecoveryDate !== state.dateKey) {
            this.dailySkyRecoveryDate = state.dateKey;
            this.#markHub(generation);
            this.#requestSchedule(generation, state.waitMs, 1, 'daily-sky-reset', { replace: true });
            return;
        }
        if (state.ready && this.dailySkyRecoveryDate === state.dateKey && !this.isGenerationReady(generation, target) && !this.pending) {
            this.#requestSchedule(generation, 0, 1, 'daily-sky-reset-ready', { replace: false });
        }
    }

    #cancelPending(reason) {
        if (!this.pending) return;
        const pending = this.pending;
        this.pending = null;
        if (pending.timer) clearTimeout(pending.timer);
        pending.timer = null;
        pending.cancellationSource.cancel(reason);
        pending.cancellationSource.dispose();
    }

    #clearPending(pending) {
        if (this.pending !== pending) return;
        this.pending = null;
        if (pending.timer) clearTimeout(pending.timer);
        pending.timer = null;
        pending.cancellationSource.dispose();
    }

    #isCurrentGeneration(generation) {
        if (!Number.isInteger(generation) || generation <= 0) return false;
        if (!this.context) return true;
        return this.context.has?.() && Number(this.context.getGeneration?.()) === generation;
    }

    #normalizeConfig(config) {
        const raw = config || {};
        const selection = raw.selection === null || raw.selection === undefined || raw.selection === '' ? null : String(raw.selection).trim();
        const output = {
            selection,
            delayMs: raw.delayMs ?? 1200,
            spawnFallbackDelayMs: raw.spawnFallbackDelayMs ?? 5000,
            retryDelayMs: raw.retryDelayMs ?? 300000,
            rejoinDelayMs: raw.rejoinDelayMs ?? 300000,
            recoveryPollMs: raw.recoveryPollMs ?? 10000,
            waitForResourcePack: raw.waitForResourcePack === true
        };
        for (const [key, value] of Object.entries(output)) {
            if (key === 'selection' || key === 'waitForResourcePack') continue;
            if (!Number.isFinite(value) || value < 0) throw new TypeError(`skyblock.modeJoin.${key} must be a non-negative number`);
        }
        return Object.freeze(output);
    }
}

module.exports = SkyblockAutoJoinService;
