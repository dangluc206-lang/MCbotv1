'use strict';

const Timeout = require('../../shared/time/Timeout');
const TimeoutError = require('../../shared/errors/TimeoutError');
const FlowError = require('../../shared/errors/FlowError');

class DungeonTeleportOperation {
    constructor({
        botId,
        commandService,
        guiManager,
        itemResolver,
        guiKnowledge = null,
        destinations,
        eventBus,
        lockPolicy,
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
            commandService,
            guiManager,
            itemResolver,
            guiKnowledge,
            destinations,
            eventBus,
            lockPolicy,
            config: {
                ...config,
                openSettleMs: Number.isFinite(config.openSettleMs) && config.openSettleMs >= 0 ? config.openSettleMs : 150
            }
        });
    }

    async execute(destinationId) {
        const owner = `dungeon:${this.botId}:${Date.now()}`;
        let stage = 'acquire-lock';
        let slot = null;
        let destination = null;

        if (!this.lockPolicy.acquire(['movement', 'teleport'], owner)) {
            throw new FlowError('Movement or teleport is busy.', {
                code: 'DUNGEON_LOCK_BUSY',
                subsystem: 'dungeon',
                operation: 'DungeonTeleportOperation',
                step: stage,
                action: 'acquire movement+teleport lock',
                resource: destinationId,
                retryable: true
            });
        }

        try {
            stage = 'resolve-destination';
            destination = this.destinations.require(destinationId);

            stage = 'prepare-gui';
            if (this.guiManager.current()) await this.guiManager.closeCurrentWindow();

            stage = 'open-dungeon-menu';
            const { session } = await this.guiManager.performAndWaitForOpen(
                () => this.commandService.send(this.config.commandKey, { confirm: false }),
                {
                    timeoutMs: this.config.guiTimeoutMs,
                    label: '/d',
                    settleMs: this.config.openSettleMs,
                    source: { commandKey: this.config.commandKey, command: '/d', clicks: [], source: 'operation' }
                }
            );

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
                : (session.window.slots || []).findIndex(item => item && this.itemResolver
                    .matches(item, destination.menuItemId, 'dungeon-menu').matched);
            if (slot < 0) {
                throw new FlowError(`Dungeon destination item not found: ${destination.menuItemId}`, {
                    code: 'DUNGEON_DESTINATION_NOT_FOUND',
                    subsystem: 'dungeon',
                    operation: 'DungeonTeleportOperation',
                    step: stage,
                    action: 'resolve destination GUI slot',
                    resource: destinationId,
                    details: {
                        menuItemId: destination.menuItemId,
                        bootstrapSlot: destination.menuSlot ?? null,
                        gui: this.guiManager.describeCurrent?.() || null
                    }
                });
            }

            stage = 'click-destination';
            const teleportPromise = this.#waitForTeleport(destination.verifyTimeoutMs, destinationId);
            await this.guiManager.click(slot);

            stage = 'wait-countdown';
            await Timeout.delay(destination.countdownMs ?? this.config.defaultCountdownMs);

            stage = 'verify-teleport';
            const event = await teleportPromise;
            return { destinationId, slot, position: event.position };
        } catch (error) {
            if (error instanceof FlowError) throw error;
            const isTimeout = error instanceof TimeoutError;
            throw FlowError.wrap(error, {
                code: isTimeout ? 'DUNGEON_TELEPORT_VERIFY_TIMEOUT' : 'DUNGEON_TELEPORT_FAILED',
                subsystem: 'dungeon',
                operation: 'DungeonTeleportOperation',
                step: stage,
                action: this.#actionForStage(stage),
                resource: destinationId,
                details: {
                    slot,
                    menuItemId: destination?.menuItemId || null,
                    verifyTimeoutMs: destination?.verifyTimeoutMs || null,
                    gui: this.guiManager.describeCurrent?.() || null
                }
            });
        } finally {
            this.lockPolicy.release(['movement', 'teleport'], owner);
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

    #waitForTeleport(timeoutMs, destinationId) {
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            throw new FlowError(`Dungeon destination verifyTimeoutMs is invalid: ${destinationId}`, {
                code: 'DUNGEON_VERIFY_TIMEOUT_INVALID',
                subsystem: 'dungeon',
                operation: 'DungeonTeleportOperation',
                step: 'verify-teleport',
                action: 'validate teleport timeout',
                resource: destinationId,
                retryable: false,
                details: { timeoutMs }
            });
        }
        return new Promise((resolve, reject) => {
            let done = false;
            const finish = (callback, value) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                off();
                callback(value);
            };
            const off = this.eventBus.on('movement:teleport', event => {
                if (event.botId === this.botId) finish(resolve, event);
            });
            const timer = setTimeout(
                () => finish(reject, new TimeoutError('Dungeon teleport was not verified.')),
                timeoutMs
            );
        });
    }
}

module.exports = DungeonTeleportOperation;
