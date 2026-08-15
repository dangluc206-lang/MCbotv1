'use strict';

const CancellationSource = require('../../shared/cancellation/CancellationSource');
const Timeout = require('../../shared/time/Timeout');

const FEATURE_KEY = 'collectorMining';

class AdaptiveMiningService {
    constructor({
        botId,
        context,
        serverCharacteristics,
        serverKey,
        config = {},
        logger = null
    }) {
        Object.assign(this, { botId, context, serverCharacteristics, serverKey, logger });
        this.config = this.#normalizeConfig(config);
        this.source = null;
        this.promise = null;
        this.parentUnsubscribe = null;
        this.generation = null;
        this.loadedCharacteristics = false;
        this.learnedIntervalMs = null;
        this.learningState = 'UNLEARNED';
        this.lastVerifiedAt = null;
        this.lastAttemptAt = 0;
        this.lastFailureAt = null;
        this.consecutiveFailures = 0;
        this.totalVerified = 0;
        this.totalRejected = 0;
        this.lastTarget = null;
        this.lastProbe = null;
        this.recalibrationRequested = false;
        this.pickaxeWarningGeneration = null;
        this.lastFailureLogAt = 0;
    }

    reconfigure(nextConfig = {}) {
        this.config = this.#normalizeConfig(nextConfig);
        return this.publicConfig();
    }

    publicConfig() {
        return Object.freeze({
            enabled: this.config.enabled,
            direction: this.config.direction,
            positiveAxis: this.config.direction === 'east' ? '+X' : null,
            cursorReachBlocks: this.config.cursorReachBlocks,
            probeIntervalsMs: Object.freeze([...this.config.probeIntervalsMs]),
            probeAttemptsPerInterval: this.config.probeAttemptsPerInterval,
            probeRequiredSuccesses: this.config.probeRequiredSuccesses,
            verificationTimeoutMs: this.config.verificationTimeoutMs,
            verificationStableMs: this.config.verificationStableMs,
            failureThreshold: this.config.failureThreshold,
            idlePollMs: this.config.idlePollMs,
            probeRetryMs: this.config.probeRetryMs
        });
    }

    status() {
        return Object.freeze({
            active: Boolean(this.promise),
            direction: this.config.direction,
            positiveAxis: this.config.direction === 'east' ? '+X' : null,
            cursorReachBlocks: this.config.cursorReachBlocks,
            learningState: this.learningState,
            learnedIntervalMs: this.learnedIntervalMs,
            observedAcceptedStartGapMs: Number(this.lastProbe?.observedAcceptedStartGapMs || 0) || null,
            recalibrationRequested: this.recalibrationRequested,
            consecutiveFailures: this.consecutiveFailures,
            totalVerified: this.totalVerified,
            totalRejected: this.totalRejected,
            lastVerifiedAt: this.lastVerifiedAt,
            lastFailureAt: this.lastFailureAt,
            lastTarget: this.lastTarget,
            lastProbe: this.lastProbe,
            serverKey: this.serverKey
        });
    }

    async start({ cancellationToken = null } = {}) {
        if (!this.config.enabled || !this.context.has()) return this.status();
        if (this.promise) return this.status();

        const source = new CancellationSource();
        this.source = source;
        this.generation = this.context.getGeneration();
        this.parentUnsubscribe = cancellationToken?.onCancelled?.(reason => {
            source.cancel(reason || 'Parent collector mode cancelled.');
            try { this.context.get()?.stopDigging?.(); } catch {}
        }) || null;

        this.promise = this.#run(source.token, this.generation)
            .catch(error => {
                if (!source.token.isCancelled) {
                    this.learningState = 'ERROR';
                    this.#logFailure('adaptive-mining-loop', error, null, true);
                }
            })
            .finally(() => {
                if (this.source === source) {
                    this.source = null;
                    this.promise = null;
                    this.generation = null;
                    this.parentUnsubscribe?.();
                    this.parentUnsubscribe = null;
                }
                source.dispose();
            });
        return this.status();
    }

    async stop(reason = 'Adaptive mining stopped.') {
        const source = this.source;
        const promise = this.promise;
        source?.cancel(reason);
        try { this.context.get()?.stopDigging?.(); } catch {}
        if (promise) await promise.catch(() => {});
        return this.status();
    }

    async requestRecalibration(reason = 'Manual recalibration requested.') {
        this.recalibrationRequested = true;
        this.learnedIntervalMs = null;
        this.learningState = 'UNLEARNED';
        this.consecutiveFailures = 0;
        this.lastAttemptAt = 0;
        try { this.context.get()?.stopDigging?.(); } catch {}
        await this.serverCharacteristics?.remove?.(this.serverKey, FEATURE_KEY);
        this.logger?.warn?.('COLLECTOR DIG INTERVAL RECALIBRATION REQUESTED', {
            botId: this.botId,
            operation: 'AdaptiveMiningService',
            step: 'request-recalibration',
            reason,
            serverKey: this.serverKey
        });
        return this.status();
    }

    async #run(token, generation) {
        await this.#loadCharacteristics();
        let aimInitialized = false;

        this.logger?.info?.('COLLECTOR ADAPTIVE DIG ACTIVE', {
            botId: this.botId,
            operation: 'AdaptiveMiningService',
            step: 'start',
            direction: this.config.direction,
            positiveAxis: this.config.direction === 'east' ? '+X' : null,
            learnedIntervalMs: this.learnedIntervalMs,
            serverKey: this.serverKey
        });

        while (!token.isCancelled) {
            token.throwIfCancelled();
            if (!this.context.has() || this.context.getGeneration() !== generation) return;
            const bot = this.context.require();

            if (bot.currentWindow) {
                await Timeout.delay(this.config.idlePollMs, { cancellationToken: token });
                continue;
            }

            const pickaxe = this.#findBestPickaxe(bot);
            if (!pickaxe) {
                if (this.pickaxeWarningGeneration !== generation) {
                    this.pickaxeWarningGeneration = generation;
                    this.logger?.warn?.('COLLECTOR PICKAXE NOT FOUND', {
                        botId: this.botId,
                        operation: 'AdaptiveMiningService',
                        step: 'equip-pickaxe',
                        action: 'put a pickaxe in inventory/hotbar'
                    });
                }
                await Timeout.delay(this.config.idlePollMs, { cancellationToken: token });
                continue;
            }
            this.pickaxeWarningGeneration = null;

            if (!this.#isPickaxe(bot.heldItem)) {
                try {
                    await bot.equip(pickaxe, 'hand');
                    aimInitialized = false;
                } catch (error) {
                    this.#logFailure('equip-pickaxe', error, null);
                    await Timeout.delay(this.config.idlePollMs, { cancellationToken: token });
                    continue;
                }
            }

            if (!aimInitialized) {
                try {
                    await bot.look(this.#directionYaw(), 0, true);
                    aimInitialized = true;
                } catch (error) {
                    this.#logFailure('aim-east', error, null);
                    await Timeout.delay(this.config.idlePollMs, { cancellationToken: token });
                    continue;
                }
            }

            if (this.recalibrationRequested || !Number.isFinite(this.learnedIntervalMs)) {
                const learned = await this.#probeInterval(token, generation);
                if (!learned) {
                    await Timeout.delay(this.config.probeRetryMs, { cancellationToken: token });
                    continue;
                }
            }

            const target = this.#targetAtCursor(bot);
            if (!target) {
                await Timeout.delay(this.config.idlePollMs, { cancellationToken: token });
                continue;
            }

            await this.#waitForInterval(this.learnedIntervalMs, token);
            this.lastAttemptAt = Date.now();
            const result = await this.#digAndVerify(bot, target, token);

            if (result.verified) {
                this.consecutiveFailures = 0;
                this.totalVerified += 1;
                this.lastVerifiedAt = new Date().toISOString();
                this.learningState = 'LEARNED';
                continue;
            }

            this.totalRejected += 1;
            this.consecutiveFailures += 1;
            this.lastFailureAt = new Date().toISOString();
            this.#logFailure('server-dig-not-verified', result.error || new Error('Server did not verify the dig.'), target);

            if (this.consecutiveFailures >= this.config.failureThreshold) {
                const staleInterval = this.learnedIntervalMs;
                this.learnedIntervalMs = null;
                this.learningState = 'STALE';
                this.recalibrationRequested = true;
                this.lastAttemptAt = 0;
                await this.serverCharacteristics?.remove?.(this.serverKey, FEATURE_KEY);
                this.logger?.warn?.('COLLECTOR DIG INTERVAL BECAME INVALID; AUTO-PROBING AGAIN', {
                    botId: this.botId,
                    operation: 'AdaptiveMiningService',
                    step: 'invalidate-learned-interval',
                    staleIntervalMs: staleInterval,
                    consecutiveFailures: this.consecutiveFailures,
                    serverKey: this.serverKey
                });
            }
        }
    }

    async #loadCharacteristics() {
        if (this.loadedCharacteristics) return;
        this.loadedCharacteristics = true;
        const learned = await this.serverCharacteristics?.get?.(this.serverKey, FEATURE_KEY);
        const interval = Number(learned?.digIntervalMs);
        if (Number.isFinite(interval) && interval >= 0) {
            this.learnedIntervalMs = interval;
            this.learningState = 'LEARNED';
            this.lastVerifiedAt = learned.lastVerifiedAt || learned.learnedAt || null;
            this.lastProbe = Object.freeze({
                intervalMs: Number(learned.requestedProbeIntervalMs ?? interval),
                observedAcceptedStartGapMs: Number(learned.observedAcceptedStartGapMs || interval),
                loadedFromCharacteristics: true
            });
            this.logger?.info?.('COLLECTOR DIG INTERVAL LOADED FROM SERVER CHARACTERISTICS', {
                botId: this.botId,
                operation: 'AdaptiveMiningService',
                step: 'load-characteristics',
                digIntervalMs: interval,
                learnedAt: learned.learnedAt || null,
                serverKey: this.serverKey
            });
        }
    }

    async #probeInterval(token, generation) {
        this.learningState = 'PROBING';
        this.recalibrationRequested = false;
        this.consecutiveFailures = 0;
        const probeStartedAt = new Date().toISOString();

        for (const intervalMs of this.config.probeIntervalsMs) {
            token.throwIfCancelled();
            if (!this.context.has() || this.context.getGeneration() !== generation) return false;

            let attempts = 0;
            let successes = 0;
            let consecutiveSuccesses = 0;
            let maxConsecutiveSuccesses = 0;
            let rejected = 0;
            let previousVerified = false;
            const acceptedPairGaps = [];
            const samples = [];

            while (attempts < this.config.probeAttemptsPerInterval) {
                token.throwIfCancelled();
                const bot = this.context.require();
                if (bot.currentWindow) {
                    await Timeout.delay(this.config.idlePollMs, { cancellationToken: token });
                    continue;
                }

                const target = await this.#waitForTarget(bot, token);
                if (!target) break;
                await this.#waitForInterval(intervalMs, token);


                const previousAttemptAt = this.lastAttemptAt;
                const startedAt = Date.now();
                const startGapMs = previousAttemptAt > 0 ? startedAt - previousAttemptAt : null;
                this.lastAttemptAt = startedAt;
                const result = await this.#digAndVerify(bot, target, token);
                attempts += 1;
                if (result.verified) {
                    successes += 1;
                    consecutiveSuccesses += 1;
                    if (previousVerified && Number.isFinite(startGapMs)) acceptedPairGaps.push(startGapMs);
                    previousVerified = true;
                    maxConsecutiveSuccesses = Math.max(maxConsecutiveSuccesses, consecutiveSuccesses);
                } else {
                    rejected += 1;
                    consecutiveSuccesses = 0;
                    previousVerified = false;
                }
                samples.push({
                    attempt: attempts,
                    verified: result.verified,
                    verification: result.verification,
                    consecutiveSuccesses,
                    target: this.#targetSummary(target),
                    elapsedMs: Date.now() - startedAt,
                    startGapMs
                });

                // The interval is valid only when the server accepts consecutive digs
                // at this spacing. Counting non-consecutive successes can incorrectly
                // learn half of the real server threshold (success/fail/success).
                if (consecutiveSuccesses >= this.config.probeRequiredSuccesses) break;
                const attemptsLeft = this.config.probeAttemptsPerInterval - attempts;
                if (consecutiveSuccesses + attemptsLeft < this.config.probeRequiredSuccesses) break;
            }

            this.lastProbe = Object.freeze({
                intervalMs,
                attempts,
                successes,
                consecutiveSuccesses,
                maxConsecutiveSuccesses,
                rejected,
                observedAcceptedStartGapMs: acceptedPairGaps.length > 0 ? Math.min(...acceptedPairGaps) : null,
                startedAt: probeStartedAt,
                finishedAt: new Date().toISOString(),
                samples: Object.freeze(samples)
            });

            this.logger?.debug?.('COLLECTOR DIG INTERVAL PROBE RESULT', {
                botId: this.botId,
                operation: 'AdaptiveMiningService',
                step: 'probe-interval',
                intervalMs,
                attempts,
                successes,
                consecutiveSuccesses,
                maxConsecutiveSuccesses,
                rejected,
                requiredConsecutiveSuccesses: this.config.probeRequiredSuccesses
            });

            if (consecutiveSuccesses >= this.config.probeRequiredSuccesses) {
                const observedAcceptedStartGapMs = acceptedPairGaps.length > 0
                    ? Math.min(...acceptedPairGaps)
                    : intervalMs;
                // Store the real start-to-start gap that the server accepted, not
                // only the requested sleep. If bot.dig itself takes longer than the
                // requested probe interval this keeps future faster tools from
                // accidentally sending the next dig earlier than the proven gap.
                const effectiveIntervalMs = Math.max(intervalMs, Math.ceil(observedAcceptedStartGapMs || 0));
                this.learnedIntervalMs = effectiveIntervalMs;
                this.learningState = 'LEARNED';
                this.consecutiveFailures = 0;
                this.lastVerifiedAt = new Date().toISOString();
                const learnedAt = new Date().toISOString();
                this.lastProbe = Object.freeze({
                    ...(this.lastProbe || {}),
                    observedAcceptedStartGapMs,
                    effectiveIntervalMs
                });
                await this.serverCharacteristics?.set?.(this.serverKey, FEATURE_KEY, {
                    digIntervalMs: effectiveIntervalMs,
                    requestedProbeIntervalMs: intervalMs,
                    observedAcceptedStartGapMs,
                    learnedAt,
                    lastVerifiedAt: this.lastVerifiedAt,
                    probeAttempts: attempts,
                    probeSuccesses: successes,
                    probeConsecutiveSuccesses: consecutiveSuccesses,
                    direction: this.config.direction,
                    cursorReachBlocks: this.config.cursorReachBlocks,
                    source: 'adaptive-probe'
                });
                this.logger?.info?.('COLLECTOR DIG INTERVAL LEARNED AND SAVED', {
                    botId: this.botId,
                    operation: 'AdaptiveMiningService',
                    step: 'save-learned-interval',
                    requestedProbeIntervalMs: intervalMs,
                    observedAcceptedStartGapMs,
                    digIntervalMs: effectiveIntervalMs,
                    serverKey: this.serverKey
                });
                return true;
            }
        }

        this.learningState = 'PROBE_FAILED';
        this.lastProbe = Object.freeze({
            ...(this.lastProbe || {}),
            exhausted: true,
            finishedAt: new Date().toISOString()
        });
        this.logger?.warn?.('COLLECTOR DIG INTERVAL PROBE EXHAUSTED; WILL RETRY WITHOUT RECONNECT', {
            botId: this.botId,
            operation: 'AdaptiveMiningService',
            step: 'probe-exhausted',
            probeIntervalsMs: this.config.probeIntervalsMs,
            retryInMs: this.config.probeRetryMs,
            serverKey: this.serverKey
        });
        return false;
    }

    async #waitForTarget(bot, token) {
        const deadline = Date.now() + this.config.targetWaitTimeoutMs;
        while (!token.isCancelled && Date.now() < deadline) {
            const target = this.#targetAtCursor(bot);
            if (target) return target;
            await Timeout.delay(this.config.idlePollMs, { cancellationToken: token });
        }
        return null;
    }

    #targetAtCursor(bot) {
        if (typeof bot.blockAtCursor !== 'function') return null;
        const target = bot.blockAtCursor(this.config.cursorReachBlocks);
        if (!target || target.type === 0 || target.name === 'air' || target.diggable === false) return null;
        this.lastTarget = this.#targetSummary(target);
        return target;
    }

    async #waitForInterval(intervalMs, token) {
        const elapsed = Date.now() - this.lastAttemptAt;
        const waitMs = Math.max(0, Number(intervalMs || 0) - elapsed);
        if (waitMs > 0) await Timeout.delay(waitMs, { cancellationToken: token });
    }

    async #digAndVerify(bot, target, token) {
        const verification = this.#watchServerDigOutcome(bot, target, token);
        let digError = null;
        try {
            if (typeof bot.dig !== 'function') throw new Error('Mineflayer bot.dig() is unavailable.');
            await bot.dig(target, true, 'raycast');
        } catch (error) {
            digError = error;
        }

        const serverResult = await verification.promise;
        verification.cleanup();
        if (serverResult.verified) return serverResult;
        if (digError) return { verified: false, verification: 'dig-error', error: digError };
        return serverResult.error
            ? serverResult
            : {
                verified: false,
                verification: serverResult.verification || 'no-server-confirmation',
                error: new Error('Server did not confirm the dig or restored the original block state.')
            };
    }

    #watchServerDigOutcome(bot, target, token) {
        let done = false;
        let timer = null;
        let settleTimer = null;
        let cancelUnsubscribe = () => {};
        let resolvePromise;
        let ackSeen = false;
        const promise = new Promise(resolve => { resolvePromise = resolve; });

        const finish = result => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            clearTimeout(settleTimer);
            bot._client?.off?.('packet', onPacket);
            cancelUnsubscribe();
            resolvePromise(result);
        };
        const same = location => location && target.position
            && Number(location.x) === Number(target.position.x)
            && Number(location.y) === Number(target.position.y)
            && Number(location.z) === Number(target.position.z);
        const changedFromOriginal = stateId => !Number.isFinite(Number(target.stateId))
            || Number(stateId) !== Number(target.stateId);
        const scheduleAckAcceptance = () => {
            ackSeen = true;
            clearTimeout(settleTimer);
            // Modern clients use prediction + digging acknowledgements. A server that
            // rejects the predicted break normally restores the original block state.
            // Give that correction a short window before accepting the acknowledgement.
            settleTimer = setTimeout(() => finish({
                verified: true,
                verification: 'server-dig-ack-no-correction'
            }), this.config.verificationStableMs);
        };
        const onPacket = (data, meta) => {
            if (meta?.name === 'block_change' && same(data?.location)) {
                if (changedFromOriginal(data?.type)) {
                    finish({ verified: true, verification: 'server-block-change' });
                } else {
                    finish({
                        verified: false,
                        verification: 'server-restored-original-state',
                        error: new Error('Server restored the original block state after the dig.')
                    });
                }
                return;
            }
            if (meta?.name === 'multi_block_change') {
                const outcome = this.#multiBlockTargetOutcome(data, target);
                if (outcome.matched) {
                    if (outcome.changed) {
                        finish({ verified: true, verification: 'server-multi-block-change' });
                    } else {
                        finish({
                            verified: false,
                            verification: 'server-restored-original-state',
                            error: new Error('Server restored the original block state after the dig.')
                        });
                    }
                    return;
                }
            }
            if (meta?.name === 'acknowledge_player_digging') {
                scheduleAckAcceptance();
            }
        };

        bot._client?.on?.('packet', onPacket);
        timer = setTimeout(() => finish({
            verified: false,
            verification: ackSeen ? 'ack-settle-timeout' : 'packet-timeout',
            error: new Error(ackSeen
                ? 'Dig acknowledgement was seen but verification did not settle.'
                : 'No server digging acknowledgement or block change was observed.')
        }), this.config.verificationTimeoutMs);
        if (token) cancelUnsubscribe = token.onCancelled(reason => finish({
            verified: false,
            verification: 'cancelled',
            error: new Error(String(reason || 'Cancelled'))
        }));

        return {
            promise,
            cleanup: () => finish({ verified: false, verification: 'cleanup' })
        };
    }

    #multiBlockTargetOutcome(data, target) {
        const section = data?.chunkCoordinates;
        const records = Array.isArray(data?.records) ? data.records : [];
        if (!section || records.length === 0) return { matched: false, changed: false };
        for (const raw of records) {
            let packed;
            try { packed = BigInt(raw); } catch { continue; }
            const stateId = Number(packed >> 12n);
            const localX = Number((packed >> 8n) & 15n);
            const localZ = Number((packed >> 4n) & 15n);
            const localY = Number(packed & 15n);
            const x = Number(section.x) * 16 + localX;
            const y = Number(section.y) * 16 + localY;
            const z = Number(section.z) * 16 + localZ;
            if (x === target.position.x && y === target.position.y && z === target.position.z) {
                return {
                    matched: true,
                    changed: !Number.isFinite(Number(target.stateId)) || stateId !== Number(target.stateId)
                };
            }
        }
        return { matched: false, changed: false };
    }

    #findBestPickaxe(bot) {
        const items = bot?.inventory?.items?.() || [];
        const pickaxes = items.filter(item => this.#isPickaxe(item));
        if (pickaxes.length === 0) return null;
        const priority = new Map([
            ['netherite_pickaxe', 0],
            ['diamond_pickaxe', 1],
            ['iron_pickaxe', 2],
            ['stone_pickaxe', 3],
            ['golden_pickaxe', 4],
            ['wooden_pickaxe', 5]
        ]);
        pickaxes.sort((a, b) => (priority.get(a.name) ?? 50) - (priority.get(b.name) ?? 50));
        return pickaxes[0];
    }

    #isPickaxe(item) {
        return Boolean(item && typeof item.name === 'string' && /_pickaxe$/i.test(item.name));
    }

    #targetSummary(target) {
        return Object.freeze({
            name: target?.name || null,
            type: Number.isInteger(target?.type) ? target.type : null,
            stateId: Number.isInteger(target?.stateId) ? target.stateId : null,
            position: target?.position ? Object.freeze({
                x: target.position.x,
                y: target.position.y,
                z: target.position.z
            }) : null
        });
    }

    #logFailure(step, error, target, force = false) {
        const now = Date.now();
        if (!force && now - this.lastFailureLogAt < 5000) return;
        this.lastFailureLogAt = now;
        this.logger?.warn?.('COLLECTOR ADAPTIVE DIG RETRY', {
            botId: this.botId,
            operation: 'AdaptiveMiningService',
            step,
            learnedIntervalMs: this.learnedIntervalMs,
            learningState: this.learningState,
            consecutiveFailures: this.consecutiveFailures,
            target: target ? this.#targetSummary(target) : null,
            error
        });
    }

    #directionYaw() {
        if (this.config.direction === 'east') return -Math.PI / 2;
        throw new Error(`Unsupported collector mining direction: ${this.config.direction}`);
    }

    #normalizeDirection(value) {
        const direction = String(value || 'east').trim().toLowerCase();
        if (direction !== 'east') throw new Error('collectorB5.mining.direction currently supports only east');
        return direction;
    }

    #normalizeConfig(config) {
        const positive = (key, fallback) => {
            const value = config[key] === undefined ? fallback : Number(config[key]);
            if (!Number.isFinite(value) || value <= 0) throw new Error(`collectorB5.mining.${key} must be positive`);
            return value;
        };
        const intervals = Array.isArray(config.probeIntervalsMs)
            ? config.probeIntervalsMs.map(Number).filter(value => Number.isFinite(value) && value >= 0)
            : [0, 25, 50, 75, 100, 125, 150, 200, 250, 350, 500, 750, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000];
        if (intervals.length === 0) throw new Error('collectorB5.mining.probeIntervalsMs must contain at least one interval');
        const attempts = Math.max(1, Math.floor(positive('probeAttemptsPerInterval', 3)));
        const required = Math.max(1, Math.floor(positive('probeRequiredSuccesses', 2)));
        if (required > attempts) throw new Error('collectorB5.mining.probeRequiredSuccesses cannot exceed probeAttemptsPerInterval');
        return Object.freeze({
            enabled: config.enabled !== false,
            direction: this.#normalizeDirection(config.direction),
            cursorReachBlocks: positive('cursorReachBlocks', 5),
            probeIntervalsMs: Object.freeze([...new Set(intervals)].sort((a, b) => a - b)),
            probeAttemptsPerInterval: attempts,
            probeRequiredSuccesses: required,
            verificationTimeoutMs: positive('verificationTimeoutMs', 700),
            verificationStableMs: positive('verificationStableMs', 120),
            targetWaitTimeoutMs: positive('targetWaitTimeoutMs', 3000),
            failureThreshold: Math.max(1, Math.floor(positive('failureThreshold', 3))),
            idlePollMs: positive('idlePollMs', 50),
            probeRetryMs: positive('probeRetryMs', 5000)
        });
    }
}

module.exports = AdaptiveMiningService;
