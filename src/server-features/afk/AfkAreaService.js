'use strict';

const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const FlowError = require('../../shared/errors/FlowError');

class AfkAreaService {
    constructor({
        botId,
        context,
        commandService,
        guiManager,
        eventBus,
        positionService,
        occupancyParser,
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

    async inspect({ cancellationToken = null } = {}) {
        try {
            const session = await this.#open(cancellationToken);
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
            return Result.fail(Status.FAILED, wrapped.message, wrapped, wrapped.toDiagnostic());
        }
    }

    async joinBestAvailable({ cancellationToken = null } = {}) {
        let selected = null;
        let teleportWaiter = null;
        try {
            const session = await this.#open(cancellationToken);
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
            teleportWaiter = this.#createTeleportWaiter(before, cancellationToken);
            const clickTask = Promise.resolve()
                .then(() => this.guiManager.click(selected.menuSlot, { timeoutMs: this.config.guiTimeoutMs }))
                .then(
                    value => ({ branch: 'click', ok: true, value }),
                    error => {
                        this.logger?.debug?.('AFK area click failed while teleport verification was pending.', {
                            botId: this.botId,
                            areaId: selected?.id || null,
                            error
                        });
                        return { branch: 'click', ok: false, error };
                    }
                );
            const teleportTask = teleportWaiter.promise.then(
                value => ({ branch: 'teleport', ok: true, value }),
                error => ({ branch: 'teleport', ok: false, error })
            );

            const first = await Promise.race([clickTask, teleportTask]);
            if (first.branch === 'click' && !first.ok) {
                teleportWaiter.cancel(first.error);
                throw first.error;
            }
            if (first.branch === 'teleport') {
                if (!first.ok) throw first.error;
                return Result.ok({ joined: true, area: selected, areas, teleport: first.value });
            }

            const teleportOutcome = await teleportTask;
            if (!teleportOutcome.ok) throw teleportOutcome.error;
            const teleport = teleportOutcome.value;
            return Result.ok({ joined: true, area: selected, areas, teleport });
        } catch (error) {
            const wrapped = FlowError.wrap(error, {
                code: error?.code || 'AFK_AREA_JOIN_FAILED',
                subsystem: 'afk',
                operation: 'AfkAreaService',
                step: selected ? 'join-area' : 'select-area',
                action: selected ? `click AFK area ${selected.id}` : 'select available AFK area',
                resource: selected?.id || null,
                retryable: true
            });
            return Result.fail(error?.code === 'CANCELLED' ? Status.CANCELLED : Status.FAILED, wrapped.message, wrapped, wrapped.toDiagnostic());
        } finally {
            teleportWaiter?.dispose?.();
        }
    }

    async #open(cancellationToken) {
        if (this.guiManager.current()) await this.guiManager.closeCurrentWindow();
        const { session } = await this.guiManager.performAndWaitForOpen(
            () => this.commandService.send(this.config.commandKey, {
                confirm: false,
                cancellationToken
            }),
            {
                timeoutMs: this.config.guiTimeoutMs,
                cancellationToken,
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

    #createTeleportWaiter(before, cancellationToken) {
        const generation = this.context.getGeneration();
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
                const eventGeneration = Number(event?.connectionGeneration ?? event?.generation);
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
}

module.exports = AfkAreaService;
