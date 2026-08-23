'use strict';

const Timeout = require('../../shared/time/Timeout');
const TimeoutError = require('../../shared/errors/TimeoutError');
const FlowError = require('../../shared/errors/FlowError');
const { findContainerSlot } = require('../../gui/ContainerSlotRange');
const OperationCancelledError = require('../../shared/errors/OperationCancelledError');
const { normalizeConnectionGeneration } = require('../../core/events/EventEnvelope');

class DungeonTeleportOperation {
    constructor({
        botId,
        context = null,
        commandService,
        guiManager,
        itemResolver,
        guiKnowledge = null,
        destinations,
        eventBus,
        config
    }) {
        if (!eventBus) throw new TypeError('eventBus is required for teleport verification');
        if (!config || typeof config !== 'object') throw new TypeError('dungeon config is required');
        if (typeof config.commandKey !== 'string' || !config.commandKey) throw new Error('dungeon.commandKey is required');
        for (const key of ['guiTimeoutMs', 'defaultCountdownMs']) {
            if (!Number.isFinite(config[key]) || config[key] < 0) throw new Error(`dungeon.${key} must be a non-negative number`);
        }
        Object.assign(this, {
            botId,
            context,
            commandService,
            guiManager,
            itemResolver,
            guiKnowledge,
            destinations,
            eventBus,
            config: {
                ...config,
                openSettleMs: Number.isFinite(config.openSettleMs) && config.openSettleMs >= 0 ? config.openSettleMs : 150
            }
        });
    }

    async execute(destinationId, {
        cancellationToken = null,
        expectedGeneration = null,
        operationContext = null
    } = {}) {
        const generation = this.#expectedGeneration(expectedGeneration, operationContext);
        let stage = 'resolve-destination';
        let slot = null;
        let destination = null;
        let teleportWait = null;

        try {
            cancellationToken?.throwIfCancelled?.();
            this.#assertCurrent(generation);
            destination = this.destinations.require(destinationId);

            stage = 'prepare-gui';
            if (this.guiManager.current()) {
                await this.guiManager.closeCurrentWindow();
                cancellationToken?.throwIfCancelled?.();
                this.#assertCurrent(generation);
            }

            stage = 'open-dungeon-menu';
            const { session } = await this.guiManager.performAndWaitForOpen(
                () => this.commandService.send(this.config.commandKey, {
                    confirm: false,
                    cancellationToken,
                    expectedGeneration: generation,
                    operationId: operationContext?.operationId || null,
                    correlationId: operationContext?.correlationId || null
                }),
                {
                    timeoutMs: this.config.guiTimeoutMs,
                    label: '/d',
                    settleMs: this.config.openSettleMs,
                    cancellationToken,
                    expectedGeneration: generation,
                    source: { commandKey: this.config.commandKey, command: '/d', clicks: [], source: 'operation' }
                }
            );
            this.#assertCurrent(generation);

            stage = 'resolve-destination-slot';
            const source = { commandKey: this.config.commandKey, command: '/d', clicks: [], actions: [], source: 'operation' };
            slot = this.guiKnowledge
                ? await this.guiKnowledge.resolveSlot(session, {
                    source,
                    roleId: `destination:${destinationId}`,
                    bootstrapSlot: Number.isInteger(destination.menuSlot) ? destination.menuSlot : null,
                    logicalItemId: destination.menuItemId,
                    context: 'dungeon-menu'
                })
                : findContainerSlot(session.window, item => item && this.itemResolver
                    .matches(item, destination.menuItemId, 'dungeon-menu').matched);
            cancellationToken?.throwIfCancelled?.();
            this.#assertCurrent(generation);
            if (slot < 0) {
                throw new FlowError(`Dungeon destination item not found: ${destination.menuItemId}`, {
                    code: 'DUNGEON_DESTINATION_NOT_FOUND',
                    subsystem: 'dungeon', operation: 'DungeonTeleportOperation', step: stage,
                    action: 'resolve destination GUI slot', resource: destinationId,
                    details: { menuItemId: destination.menuItemId, bootstrapSlot: destination.menuSlot ?? null, gui: this.guiManager.describeCurrent?.() || null }
                });
            }

            stage = 'click-destination';
            teleportWait = this.#createTeleportWait({
                timeoutMs: destination.verifyTimeoutMs,
                destinationId,
                cancellationToken,
                expectedGeneration: generation
            });
            await this.guiManager.click(slot, {
                cancellationToken,
                expectedGeneration: generation,
                operationId: operationContext?.operationId || null,
                correlationId: operationContext?.correlationId || null
            });
            cancellationToken?.throwIfCancelled?.();
            this.#assertCurrent(generation);

            stage = 'wait-countdown';
            await Timeout.delay(destination.countdownMs ?? this.config.defaultCountdownMs, { cancellationToken });
            this.#assertCurrent(generation);

            stage = 'verify-teleport';
            const event = await teleportWait.promise;
            teleportWait = null;
            this.#assertCurrent(generation);
            return { destinationId, slot, position: event.position || null, connectionGeneration: generation };
        } catch (error) {
            if (error instanceof FlowError || error?.code === 'CANCELLED') throw error;
            const isTimeout = error instanceof TimeoutError;
            throw FlowError.wrap(error, {
                code: isTimeout ? 'DUNGEON_TELEPORT_VERIFY_TIMEOUT' : 'DUNGEON_TELEPORT_FAILED',
                subsystem: 'dungeon', operation: 'DungeonTeleportOperation', step: stage,
                action: this.#actionForStage(stage), resource: destinationId,
                details: { slot, menuItemId: destination?.menuItemId || null, verifyTimeoutMs: destination?.verifyTimeoutMs || null, expectedGeneration: generation, gui: this.guiManager.describeCurrent?.() || null }
            });
        } finally {
            if (teleportWait) {
                teleportWait.cancel('Dungeon teleport wait cancelled.');
                await teleportWait.observation;
            }
        }
    }

    #actionForStage(stage) {
        const actions = {
            'resolve-destination': 'resolve dungeon destination',
            'prepare-gui': 'close current GUI',
            'open-dungeon-menu': 'send /d and wait for GUI',
            'resolve-destination-slot': 'resolve destination GUI slot',
            'click-destination': 'click dungeon destination',
            'wait-countdown': 'wait dungeon countdown',
            'verify-teleport': 'wait for movement:teleport'
        };
        return actions[stage] || stage;
    }

    #createTeleportWait({ timeoutMs, destinationId, cancellationToken, expectedGeneration }) {
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            throw new FlowError(`Dungeon destination verifyTimeoutMs is invalid: ${destinationId}`, {
                code: 'DUNGEON_VERIFY_TIMEOUT_INVALID', subsystem: 'dungeon', operation: 'DungeonTeleportOperation',
                step: 'verify-teleport', action: 'validate teleport timeout', resource: destinationId,
                retryable: false, details: { timeoutMs }
            });
        }
        let settled = false;
        let rejectPromise = null;
        let timer = null;
        let offTeleport = () => {};
        let offEnd = () => {};
        let offCancellation = () => {};
        const cleanup = () => {
            if (timer) clearTimeout(timer);
            timer = null;
            offTeleport(); offEnd(); offCancellation();
            offTeleport = offEnd = offCancellation = () => {};
        };
        const promise = new Promise((resolve, reject) => {
            rejectPromise = reject;
            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                cleanup();
                callback(value);
            };
            offTeleport = this.eventBus.on('movement:teleport', event => {
                if (event.botId !== this.botId) return;
                if (normalizeConnectionGeneration(event) !== expectedGeneration) return;
                if (!this.#isCurrent(expectedGeneration)) return;
                finish(resolve, event);
            });
            offEnd = this.eventBus.on('connection:ended', event => {
                if (event.botId !== this.botId || normalizeConnectionGeneration(event) !== expectedGeneration) return;
                finish(reject, new FlowError('Connection ended during dungeon teleport.', {
                    code: 'DISCONNECTED', subsystem: 'dungeon', operation: 'DungeonTeleportOperation', step: 'verify-teleport', retryable: true,
                    details: { expectedGeneration }
                }));
            });
            timer = setTimeout(() => finish(reject, new TimeoutError('Dungeon teleport was not verified.')), timeoutMs);
            if (cancellationToken?.onCancelled) {
                offCancellation = cancellationToken.onCancelled(reason => finish(reject,
                    new OperationCancelledError(String(reason || 'Dungeon teleport wait cancelled.'))));
            }
        });
        const observation = promise.then(
            () => null,
            error => error
        );
        return Object.freeze({
            promise,
            observation,
            cancel: reason => {
                if (settled) return false;
                settled = true;
                cleanup();
                rejectPromise(new OperationCancelledError(String(reason || 'Dungeon teleport wait cancelled.')));
                return true;
            }
        });
    }

    #expectedGeneration(expectedGeneration, operationContext) {
        const candidate = expectedGeneration ?? operationContext?.connectionGeneration ?? this.context?.getGeneration?.();
        const generation = Number(candidate);
        if (!Number.isInteger(generation) || generation <= 0) {
            throw new FlowError('Dungeon teleport requires a connection generation.', {
                code: 'DUNGEON_GENERATION_REQUIRED', subsystem: 'dungeon', operation: 'DungeonTeleportOperation',
                step: 'generation-guard', retryable: true
            });
        }
        return generation;
    }

    #isCurrent(generation) {
        if (!this.context) return true;
        return this.context.has?.() && Number(this.context.getGeneration?.()) === generation;
    }

    #assertCurrent(generation) {
        if (this.#isCurrent(generation)) return;
        throw new FlowError('Dungeon teleport belongs to a stale connection generation.', {
            code: 'DISCONNECTED', subsystem: 'dungeon', operation: 'DungeonTeleportOperation', step: 'generation-guard', retryable: true,
            details: { expectedGeneration: generation, currentGeneration: this.context?.getGeneration?.() ?? null }
        });
    }
}

module.exports = DungeonTeleportOperation;