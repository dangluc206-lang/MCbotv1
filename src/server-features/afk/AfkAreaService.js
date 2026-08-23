'use strict';

const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const FlowError = require('../../shared/errors/FlowError');
const { normalizeConnectionGeneration } = require('../../core/events/EventEnvelope');
const Operation = require('../../operations/Operation');
const CancellationSource = require('../../shared/cancellation/CancellationSource');
const OperationCancellation = require('../../operations/OperationCancellation');

class AfkAreaService {
    constructor({
        botId,
        context,
        commandService,
        guiManager,
        eventBus,
        positionService,
        occupancyParser,
        operationManager = null,
        config = {},
        logger = null
    }) {
        if (!context || !commandService || !guiManager || !eventBus || !positionService || !occupancyParser) {
            throw new TypeError('AfkAreaService dependencies are required');
        }
        Object.assign(this, {
            botId,
            context,
            commandService,
            guiManager,
            eventBus,
            positionService,
            occupancyParser,
            operationManager,
            logger
        });
        this.config = this.#normalize(config);
    }

    areas() {
        return this.config.areas.map(area => Object.freeze({ ...area, destination: { ...area.destination } }));
    }

    area(id) {
        return this.areas().find(area => area.id === id) || null;
    }

    reconfigure(config) {
        this.config = this.#normalize(config);
        return this.areas();
    }

    async inspect(options = {}) {
        const { cancellationToken = null, operationContext = null } = options;
        if (this.operationManager && !operationContext) {
            return this.#runManaged('AfkAreaService.inspect', ['gui'], options,
                context => this.inspect({ ...options, operationContext: context, cancellationToken: context.cancellation.token, expectedGeneration: context.connectionGeneration }));
        }
        try {
            const generation = this.#expectedGeneration(options);
            this.#assertGeneration(generation);
            const session = await this.#open(cancellationToken, generation, operationContext);
            this.#assertGeneration(generation);
            const areas = this.#readAreas(session.window);
            return Result.ok({ areas, sessionId: session.id });
        } catch (error) {
            const wrapped = FlowError.wrap(error, {
                code: 'AFK_MENU_INSPECT_FAILED',
                subsystem: 'afk',
                operation: 'AfkAreaService',
                step: 'inspect',
                action: 'open /afk and read area occupancy'
            });
            return Result.fail(Operation.statusForError(wrapped), wrapped.message, wrapped, wrapped.toDiagnostic());
        }
    }

    async joinBestAvailable(options = {}) {
        const { cancellationToken = null, operationContext = null } = options;
        if (this.operationManager && !operationContext) {
            return this.#runManaged('AfkAreaService.joinBestAvailable', ['gui', 'movement', 'teleport'], options,
                context => this.joinBestAvailable({ ...options, operationContext: context, cancellationToken: context.cancellation.token, expectedGeneration: context.connectionGeneration }));
        }

        let selected = null;
        let teleportWaiter = null;
        let clickTask = null;
        let teleportTask = null;
        const branchCancellation = new CancellationSource();
        const unlinkParentCancellation = OperationCancellation.link(cancellationToken, branchCancellation);
        const branchToken = branchCancellation.token;

        const settleBranches = async reason => {
            branchCancellation.cancel(reason);
            teleportWaiter?.cancel?.(reason instanceof Error ? reason : new FlowError(String(reason || 'AFK operation settled.'), {
                code: 'CANCELLED', subsystem: 'afk', operation: 'AfkAreaService', step: 'cleanup'
            }));
            const pending = [clickTask, teleportTask].filter(Boolean);
            // Promise.allSettled attaches observers immediately without forcing the
            // public result to wait forever on a dependency that ignores cancellation.
            // Real queued click primitives observe branchToken synchronously and are
            // revoked before this method can settle.
            if (pending.length) void Promise.allSettled(pending);
            await Promise.resolve();
        };

        try {
            const generation = this.#expectedGeneration(options);
            this.#assertGeneration(generation);
            const session = await this.#open(branchToken, generation, operationContext);
            this.#assertGeneration(generation);
            const areas = this.#readAreas(session.window);
            selected = areas.find(area => area.occupancy.known && !area.occupancy.full) || null;

            this.logger?.info?.('AFK AREA SUMMARY', {
                botId: this.botId,
                operation: 'AfkAreaService',
                step: 'select-area',
                phase: selected ? 'READY' : 'WAIT',
                action: selected ? `select ${selected.id}` : 'wait for available AFK area',
                areas: areas.map(area => ({
                    id: area.id,
                    slot: area.menuSlot,
                    current: area.occupancy.current,
                    capacity: area.occupancy.capacity,
                    full: area.occupancy.full
                }))
            });

            if (!selected) {
                try {
                    await this.guiManager.closeCurrentWindow();
                } catch (error) {
                    this.logger?.debug?.('AFK menu close failed after no area was available.', { error });
                }
                return Result.ok({ joined: false, reason: 'NO_AVAILABLE_AREA', areas });
            }

            const before = this.positionService.current();
            teleportWaiter = this.#createTeleportWaiter(before, branchToken, generation);
            clickTask = Promise.resolve()
                .then(() => this.guiManager.click(selected.menuSlot, {
                    timeoutMs: this.config.guiTimeoutMs,
                    cancellationToken: branchToken,
                    expectedGeneration: generation,
                    operationId: operationContext?.operationId || null,
                    correlationId: operationContext?.correlationId || null
                }))
                .then(
                    value => ({ branch: 'click', ok: true, value }),
                    error => ({ branch: 'click', ok: false, error })
                );
            teleportTask = teleportWaiter.promise.then(
                value => ({ branch: 'teleport', ok: true, value }),
                error => ({ branch: 'teleport', ok: false, error })
            );

            const first = await Promise.race([clickTask, teleportTask]);
            if (first.branch === 'click' && !first.ok) {
                await settleBranches(first.error);
                throw first.error;
            }
            if (first.branch === 'teleport') {
                await settleBranches(first.ok ? 'AFK teleport verified; cancel pending click branch.' : first.error);
                if (!first.ok) throw first.error;
                this.#assertGeneration(generation);
                return Result.ok({ joined: true, area: selected, areas, teleport: first.value });
            }

            const teleportOutcome = await teleportTask;
            await settleBranches(teleportOutcome.ok ? 'AFK teleport verified.' : teleportOutcome.error);
            if (!teleportOutcome.ok) throw teleportOutcome.error;
            this.#assertGeneration(generation);
            return Result.ok({ joined: true, area: selected, areas, teleport: teleportOutcome.value });
        } catch (error) {
            await settleBranches(error);
            const wrapped = FlowError.wrap(error, {
                code: error?.code || 'AFK_AREA_JOIN_FAILED',
                subsystem: 'afk',
                operation: 'AfkAreaService',
                step: selected ? 'join-area' : 'select-area',
                action: selected ? `click AFK area ${selected.id}` : 'select available AFK area',
                resource: selected?.id || null,
                retryable: true
            });
            return Result.fail(Operation.statusForError(error), wrapped.message, wrapped, wrapped.toDiagnostic());
        } finally {
            await settleBranches('AFK join operation settled.');
            teleportWaiter?.dispose?.();
            unlinkParentCancellation();
            branchCancellation.dispose();
        }
    }

    async #open(cancellationToken, expectedGeneration, operationContext) {
        this.#assertGeneration(expectedGeneration);
        if (this.guiManager.current()) await this.guiManager.closeCurrentWindow();
        const { session } = await this.guiManager.performAndWaitForOpen(
            () => this.commandService.send(this.config.commandKey, {
                confirm: false,
                cancellationToken,
                expectedGeneration,
                operationId: operationContext?.operationId || null,
                correlationId: operationContext?.correlationId || null
            }),
            {
                timeoutMs: this.config.guiTimeoutMs,
                cancellationToken,
                expectedGeneration,
                label: '/afk',
                settleMs: this.config.openSettleMs,
                source: {
                    commandKey: this.config.commandKey,
                    command: '/afk',
                    clicks: [],
                    source: 'operation'
                }
            }
        );
        return session;
    }

    #readAreas(window) {
        return this.config.areas
            .slice()
            .sort((a, b) => a.priority - b.priority)
            .map(area => {
                const item = window?.slots?.[area.menuSlot] || null;
                return Object.freeze({
                    ...area,
                    destination: { ...area.destination },
                    occupancy: this.occupancyParser.parse(item, area),
                    hasMenuItem: Boolean(item)
                });
            });
    }

    #createTeleportWaiter(before, cancellationToken, generation) {
        let cancel = () => {};
        let dispose = () => {};
        const promise = new Promise((resolve, reject) => {
            let done = false;
            let unsubscribeCancel = () => {};
            const unsubscribers = [];
            let timeout = null;
            let poll = null;
            const cleanup = () => {
                if (timeout) clearTimeout(timeout);
                if (poll) clearInterval(poll);
                timeout = null;
                poll = null;
                for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
                unsubscribeCancel();
                unsubscribeCancel = () => {};
            };
            const finish = (fn, value) => {
                if (done) return;
                done = true;
                cleanup();
                fn(value);
            };
            const verifyPosition = position => {
                if (!position || !before) return false;
                return this.positionService.distance(before, position) >= this.config.teleportMinDistance;
            };
            const staleError = () => new FlowError('Connection changed while waiting for AFK teleport.', {
                code: 'AFK_STALE_GENERATION', subsystem: 'afk', operation: 'AfkAreaService', step: 'verify-teleport', retryable: true,
                details: { expectedGeneration: generation, currentGeneration: this.context.getGeneration() }
            });
            const checkCurrentGeneration = () => {
                if (Number(this.context.getGeneration()) !== Number(generation) || !this.context.has()) {
                    finish(reject, staleError());
                    return false;
                }
                return true;
            };

            // First V1 fishing treated the server's forcedMove packet itself as
            // authoritative teleport confirmation. Do the same here. Requiring an
            // additional position delta can falsely time out when the server
            // corrects/teleports the player to the same AFK spawn coordinates.
            unsubscribers.push(this.eventBus.on('movement:teleport', event => {
                const eventGeneration = normalizeConnectionGeneration(event);
                if (event?.botId !== this.botId || !Number.isFinite(eventGeneration) || eventGeneration !== Number(generation)) return;
                if (!checkCurrentGeneration()) return;
                const position = this.positionService.current() || event.position || null;
                finish(resolve, { source: 'forcedMove', position });
            }));
            const onConnectionTransition = event => {
                if (event?.botId !== this.botId) return;
                checkCurrentGeneration();
            };
            for (const eventName of ['connection:client-attached', 'connection:spawned', 'connection:ended']) {
                unsubscribers.push(this.eventBus.on(eventName, onConnectionTransition));
            }
            poll = setInterval(() => {
                try {
                    if (!checkCurrentGeneration()) return;
                    const position = this.positionService.current();
                    if (verifyPosition(position)) finish(resolve, { source: 'position-delta', position });
                } catch (error) {
                    this.logger?.debug?.('AFK teleport position poll failed.', { error });
                }
            }, 50);
            timeout = setTimeout(() => {
                finish(reject, new FlowError('AFK area click did not produce a verified teleport.', {
                    code: 'AFK_TELEPORT_VERIFY_TIMEOUT',
                    subsystem: 'afk',
                    operation: 'AfkAreaService',
                    step: 'verify-teleport',
                    action: 'wait for AFK teleport',
                    retryable: true,
                    details: { before, timeoutMs: this.config.teleportTimeoutMs }
                }));
            }, this.config.teleportTimeoutMs);
            if (cancellationToken) {
                unsubscribeCancel = cancellationToken.onCancelled(reason => {
                    finish(reject, new FlowError(String(reason || 'AFK teleport cancelled.'), {
                        code: 'CANCELLED', subsystem: 'afk', operation: 'AfkAreaService', step: 'verify-teleport'
                    }));
                });
            }
            cancel = error => finish(reject, error instanceof Error ? error : new FlowError(String(error || 'AFK teleport waiter cancelled.'), {
                code: 'CANCELLED', subsystem: 'afk', operation: 'AfkAreaService', step: 'verify-teleport'
            }));
            dispose = cleanup;
        });
        return {
            promise,
            cancel: error => cancel(error),
            dispose: () => dispose()
        };
    }

    #normalize(config) {
        if (!config || typeof config !== 'object') throw new TypeError('fishing mode config is required');
        if (typeof config.commandKey !== 'string' || !config.commandKey.trim()) throw new Error('fishing.commandKey is required');
        if (!Array.isArray(config.areas) || config.areas.length === 0) throw new Error('fishing.areas must not be empty');
        const areas = config.areas.map((area, index) => {
            if (!area || typeof area !== 'object') throw new Error(`fishing.areas[${index}] must be an object`);
            if (typeof area.id !== 'string' || !area.id.trim()) throw new Error(`fishing.areas[${index}].id is required`);
            if (!Number.isInteger(area.menuSlot) || area.menuSlot < 0) throw new Error(`fishing.areas[${index}].menuSlot must be a non-negative integer`);
            return Object.freeze({
                ...area,
                priority: Number.isFinite(area.priority) ? Number(area.priority) : index + 1,
                capacity: Number.isFinite(area.capacity) && area.capacity >= 0 ? Number(area.capacity) : null,
                destination: area.destination && typeof area.destination === 'object' ? { ...area.destination } : { x: null, y: null, z: null }
            });
        });
        return Object.freeze({
            ...config,
            guiTimeoutMs: this.#positive(config.guiTimeoutMs, 7000),
            openSettleMs: this.#nonNegative(config.openSettleMs, 150),
            teleportTimeoutMs: this.#positive(config.teleportTimeoutMs, 10000),
            teleportMinDistance: this.#positive(config.teleportMinDistance, 1.5),
            areas
        });
    }

    #positive(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : fallback;
    }

    #nonNegative(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? number : fallback;
    }

    #expectedGeneration(options = {}) {
        const generation = Number(options.expectedGeneration ?? options.operationContext?.connectionGeneration ?? this.context.getGeneration());
        return Number.isInteger(generation) && generation > 0 ? generation : null;
    }

    #assertGeneration(generation) {
        if (Number.isInteger(generation) && generation > 0 && this.context.has() && Number(this.context.getGeneration()) === generation) return;
        throw new FlowError('AFK workflow belongs to a stale connection generation.', {
            code: 'AFK_STALE_GENERATION', subsystem: 'afk', operation: 'AfkAreaService', step: 'generation-guard', retryable: true,
            details: { expectedGeneration: generation, currentGeneration: this.context.getGeneration?.() ?? null }
        });
    }

    #runManaged(name, lockKeys, options, action) {
        const operation = new Operation({ name, lockKeys, returnsResult: true, execute: action });
        return this.operationManager.run(operation, {
            operationContext: options.operationContext || null,
            cancellationToken: options.cancellationToken || null,
            connectionGeneration: this.#expectedGeneration(options),
            timeoutMs: options.timeoutMs,
            queueWaitTimeoutMs: options.queueWaitTimeoutMs,
            correlationId: options.correlationId || null,
            metadata: { subsystem: 'afk', action: name }
        });
    }
}

module.exports = AfkAreaService;
