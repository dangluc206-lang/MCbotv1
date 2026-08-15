'use strict';

const Timeout = require('../../shared/time/Timeout');

class FishingMovementProbeService {
    constructor({ movementOperation, connectionState, config = {}, delay = Timeout.delay, clock = () => Date.now(), logger = null }) {
        if (!movementOperation || !connectionState) throw new TypeError('FishingMovementProbeService dependencies are required');
        Object.assign(this, { movementOperation, connectionState, delay, clock, logger });
        this.active = false;
        this.reconfigure(config);
    }

    reconfigure(config = {}) {
        const probe = config.probe || {};
        const configuredProfiles = Array.isArray(probe.profiles) ? probe.profiles : [];
        const profiles = configuredProfiles.length > 0 ? configuredProfiles : [{ name: 'shift-walk-continuous', forward: true, sneak: true, sprint: false, jump: false }];
        this.config = Object.freeze({
            enabled: probe.enabled === true,
            maxProfiles: Math.max(1, Math.floor(this.#positive(probe.maxProfiles, profiles.length))),
            totalTimeoutMs: this.#positive(probe.totalTimeoutMs, 30000),
            profileTimeoutMs: this.#positive(probe.profileTimeoutMs, 10000),
            gapMs: this.#nonNegative(probe.gapMs, 100),
            profiles: Object.freeze(profiles.map(profile => Object.freeze({
                name: String(profile.name || 'profile'),
                forward: profile.forward !== false,
                sneak: profile.sneak !== false,
                sprint: profile.sprint === true,
                jump: profile.jump === true
            })))
        });
    }

    async run({ destination, expectedGeneration, cancellationToken = null } = {}) {
        if (!this.config.enabled) return Object.freeze({ enabled: false, selected: null, results: Object.freeze([]) });
        if (this.active) return Object.freeze({ enabled: true, busy: true, selected: null, results: Object.freeze([]) });
        this.active = true;
        const startedAt = this.clock();
        const results = [];
        try {
            const profiles = this.config.profiles.slice(0, this.config.maxProfiles);
            for (const profile of profiles) {
                cancellationToken?.throwIfCancelled?.();
                if (!this.connectionState.isCurrentGeneration(expectedGeneration)) {
                    return this.#freeze({ enabled: true, requiresReconnect: true, selected: null, results });
                }
                if (this.clock() - startedAt >= this.config.totalTimeoutMs) break;
                try {
                    const movement = await this.movementOperation.move({
                        destination,
                        expectedGeneration,
                        timeoutMs: Math.min(this.config.profileTimeoutMs, this.config.totalTimeoutMs),
                        cancellationToken,
                        profile
                    });
                    results.push({ profile: profile.name, success: true, movement });
                    return this.#freeze({ enabled: true, selected: profile.name, results });
                } catch (error) {
                    if (error?.code === 'CANCELLED') throw error;
                    results.push({ profile: profile.name, success: false, code: error?.code || 'FAILED', message: String(error?.message || error) });
                    if (error?.code === 'FISHING_STALE_GENERATION' || error?.code === 'FISHING_MOVEMENT_DISCONNECTED') {
                        return this.#freeze({ enabled: true, requiresReconnect: true, selected: null, results });
                    }
                }
                if (this.config.gapMs > 0) await this.delay(this.config.gapMs, { cancellationToken });
            }
            return this.#freeze({ enabled: true, exhausted: true, selected: null, results });
        } finally {
            this.active = false;
        }
    }

    status() {
        return Object.freeze({ active: this.active, enabled: this.config.enabled, maxProfiles: this.config.maxProfiles });
    }

    async stop() { this.active = false; }
    async destroy() { await this.stop(); }

    #freeze(value) {
        return Object.freeze({ ...value, results: Object.freeze(value.results.map(item => Object.freeze({ ...item }))) });
    }

    #positive(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : fallback;
    }

    #nonNegative(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? number : fallback;
    }
}

module.exports = FishingMovementProbeService;