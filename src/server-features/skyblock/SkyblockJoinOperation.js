'use strict';

const Timeout = require('../../shared/time/Timeout');
const TimeoutError = require('../../shared/errors/TimeoutError');
const OperationCancelledError = require('../../shared/errors/OperationCancelledError');
const FlowError = require('../../shared/errors/FlowError');
const { normalizeConnectionGeneration } = require('../../core/events/EventEnvelope');

class SkyblockJoinOperation {
    constructor({
        botId,
        context = null,
        commandService,
        guiManager,
        guiKnowledge = null,
        eventBus,
        config
    }) {
        if (typeof botId !== 'string' || !botId.trim()) {
            throw new TypeError('botId must be a non-empty string');
        }
        if (!commandService || typeof commandService.send !== 'function') {
            throw new TypeError('commandService.send is required');
        }
        if (!guiManager || typeof guiManager.click !== 'function' || typeof guiManager.current !== 'function') {
            throw new TypeError('guiManager with click() and current() is required');
        }
        if (!eventBus || typeof eventBus.on !== 'function') {
            throw new TypeError('eventBus is required');
        }

        this.botId = botId;
        this.context = context;
        this.commandService = commandService;
        this.guiManager = guiManager;
        this.guiKnowledge = guiKnowledge;
        this.eventBus = eventBus;
        this.config = this.#validateConfig(config);
    }

    async execute(selectionId = null, {
        cancellationToken = null,
        expectedGeneration = null,
        operationContext = null
    } = {}) {
        cancellationToken?.throwIfCancelled?.();
        const generation = this.#expectedGeneration(expectedGeneration, operationContext);
        this.#assertCurrent(generation);

        const resolvedSelectionId = selectionId || this.config.defaultSelection;
        const selection = this.config.selections[resolvedSelectionId];
        if (!selection) {
            throw new RangeError(`Unknown skyblock selection: ${resolvedSelectionId}`);
        }

        let firstWait = null;
        let secondWait = null;
        let teleportWait = null;

        try {
            const previousSessionId = this.guiManager.current()?.id || null;
            firstWait = this.#createGuiWait({
                previousSessionId,
                definitionId: this.config.entryGuiId,
                timeoutMs: this.config.guiTimeoutMs,
                cancellationToken,
                expectedGeneration: generation,
                label: 'skyblock selection GUI'
            });

            const sent = await this.commandService.send(this.config.commandKey, {
                confirm: false,
                cancellationToken,
                expectedGeneration: generation,
                operationId: operationContext?.operationId || null,
                correlationId: operationContext?.correlationId || null
            });
            if (!sent.success) {
                throw sent.error || new Error(sent.message || 'Skyblock command failed.');
            }

            const selectionSession = await firstWait.promise;
            firstWait = null;
            this.#assertCurrent(generation);

            // /sky is a server-wide static GUI. Its slot addresses come from
            // config/skyblock/join.json and must not depend on per-bot learned
            // GUI knowledge. A new bot may receive windowOpen before the slot
            // items are populated; resolving through per-bot knowledge at that
            // instant can return -1 and then wait forever on slot -1.
            //
            // Use the configured shared slot immediately, then let
            // #waitForSlotReady wait for the server to populate that slot.
            const selectionSlot = selection.slot;

            await this.#waitForSlotReady({
                sessionId: selectionSession.id,
                slot: selectionSlot,
                timeoutMs: this.config.slotReadyTimeoutMs,
                cancellationToken,
                expectedGeneration: generation,
                label: `skyblock selection slot ${selectionSlot}`
            });
            await Timeout.delay(this.config.selectionSettleMs, { cancellationToken });
            this.#assertCurrent(generation);

            secondWait = this.#createGuiWait({
                previousSessionId: selectionSession.id,
                definitionId: this.config.joinGuiId,
                timeoutMs: this.config.guiTimeoutMs,
                cancellationToken,
                expectedGeneration: generation,
                label: 'skyblock join GUI'
            });

            await this.guiManager.click(selectionSlot, {
                timeoutMs: this.config.clickTimeoutMs,
                cancellationToken,
                expectedGeneration: generation,
                operationId: operationContext?.operationId || null,
                correlationId: operationContext?.correlationId || null
            });

            const joinSession = await secondWait.promise;
            secondWait = null;
            this.#assertCurrent(generation);

            // Same rule for the second /sky GUI: this is shared server
            // structure, not account-specific state. /kho, inventory and /pv 2
            // may differ per account, but /sky must use the configured slot.
            const joinSlot = this.config.joinSlot;

            await this.#waitForSlotReady({
                sessionId: joinSession.id,
                slot: joinSlot,
                timeoutMs: this.config.slotReadyTimeoutMs,
                cancellationToken,
                expectedGeneration: generation,
                label: `skyblock join slot ${joinSlot}`
            });
            await Timeout.delay(this.config.joinSettleMs, { cancellationToken });
            this.#assertCurrent(generation);

            // Arm teleport verification BEFORE clicking the final join slot so a fast
            // position packet cannot race past the listener.
            const positionBeforeJoin = this.#currentPosition();
            teleportWait = this.#createTeleportWait({
                timeoutMs: this.config.postJoinTimeoutMs,
                cancellationToken,
                expectedGeneration: generation,
                positionBeforeJoin
            });

            await this.guiManager.click(joinSlot, {
                timeoutMs: this.config.clickTimeoutMs,
                cancellationToken,
                expectedGeneration: generation,
                operationId: operationContext?.operationId || null,
                correlationId: operationContext?.correlationId || null
            });

            const teleport = await teleportWait.promise;
            teleportWait = null;
            this.#assertCurrent(generation);

            return Object.freeze({
                selectionId: resolvedSelectionId,
                selectionSlot,
                joinSlot,
                selectionSessionId: selectionSession.id,
                joinSessionId: joinSession.id,
                verified: teleport.verified || 'movement:teleport',
                position: teleport.position || null,
                connectionGeneration: generation
            });
        } finally {
            await this.#cancelWait(firstWait, 'Skyblock selection wait cancelled.');
            await this.#cancelWait(secondWait, 'Skyblock join wait cancelled.');
            await this.#cancelWait(teleportWait, 'Skyblock teleport wait cancelled.');
        }
    }

    async #waitForSlotReady({
        sessionId,
        slot,
        timeoutMs,
        cancellationToken,
        expectedGeneration,
        label
    }) {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() <= deadline) {
            cancellationToken?.throwIfCancelled?.();
            this.#assertCurrent(expectedGeneration);
            const session = this.guiManager.current();
            if (session?.id === sessionId && Number(session.connectionGeneration) === expectedGeneration) {
                const item = session.window?.slots?.[slot];
                if (item) return item;
            }
            await Timeout.delay(50, { cancellationToken });
        }

        throw new TimeoutError(`Timed out waiting for ${label} to contain an item.`);
    }

    #createTeleportWait({ timeoutMs, cancellationToken, expectedGeneration, positionBeforeJoin = null }) {
        let settled = false;
        let rejectPromise = null;
        let unsubscribeCancellation = () => {};
        let unsubscribeTeleport = () => {};
        let unsubscribePosition = () => {};
        let unsubscribeEnd = () => {};
        let timer = null;

        const cleanup = () => {
            if (timer) clearTimeout(timer);
            timer = null;
            unsubscribeTeleport();
            unsubscribePosition();
            unsubscribeEnd();
            unsubscribeCancellation();
            unsubscribeTeleport = () => {};
            unsubscribePosition = () => {};
            unsubscribeEnd = () => {};
            unsubscribeCancellation = () => {};
        };

        const promise = new Promise((resolve, reject) => {
            rejectPromise = reject;

            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                cleanup();
                callback(value);
            };
            const currentEvent = event => event?.botId === this.botId
                && normalizeConnectionGeneration(event) === expectedGeneration
                && this.#isCurrent(expectedGeneration);

            unsubscribeTeleport = this.eventBus.on('movement:teleport', event => {
                if (!currentEvent(event)) return;
                finish(resolve, { ...event, verified: 'movement:teleport' });
            });

            // Some proxy/server teleport paths update entity position without
            // Mineflayer emitting forcedMove. Accept a large, generation-owned
            // position delta as a secondary verification signal. The bot is not
            // pathing while the join GUI is open, so this avoids false timeout
            // without treating tiny movement/jitter as a successful join.
            unsubscribePosition = this.eventBus.on('movement:position', event => {
                if (!currentEvent(event)) return;
                if (!this.#positionDeltaAtLeast(positionBeforeJoin, event.position, this.config.postJoinMinPositionDelta)) return;
                finish(resolve, { ...event, verified: 'movement:position-delta' });
            });

            unsubscribeEnd = this.eventBus.on('connection:ended', event => {
                if (event.botId !== this.botId || normalizeConnectionGeneration(event) !== expectedGeneration) return;
                finish(reject, new FlowError('Connection ended during skyblock join.', {
                    code: 'DISCONNECTED', subsystem: 'skyblock', operation: 'SkyblockJoinOperation',
                    step: 'verify-teleport', retryable: true, details: { expectedGeneration }
                }));
            });

            timer = setTimeout(() => {
                finish(reject, new TimeoutError('Skyblock join click was sent but teleport was not verified.'));
            }, timeoutMs);

            if (cancellationToken) {
                unsubscribeCancellation = cancellationToken.onCancelled(reason => {
                    finish(
                        reject,
                        new OperationCancelledError(String(reason || 'Skyblock teleport wait cancelled.'))
                    );
                });
            }
        });

        const observation = promise.then(
            () => null,
            error => error
        );

        return {
            promise,
            observation,
            cancel(reason) {
                if (settled) return;
                settled = true;
                cleanup();
                rejectPromise(new OperationCancelledError(reason));
            }
        };
    }

    #currentPosition() {
        const position = this.context?.get?.()?.entity?.position;
        if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) return null;
        return Object.freeze({ x: position.x, y: position.y, z: position.z });
    }

    #positionDeltaAtLeast(before, after, minimum) {
        if (!before || !after || ![after.x, after.y, after.z].every(Number.isFinite)) return false;
        const dx = after.x - before.x;
        const dy = after.y - before.y;
        const dz = after.z - before.z;
        return Math.hypot(dx, dy, dz) >= minimum;
    }

    #createGuiWait({
        previousSessionId,
        definitionId,
        timeoutMs,
        cancellationToken,
        expectedGeneration,
        label
    }) {
        let settled = false;
        let rejectPromise = null;
        let unsubscribeCancellation = () => {};
        let unsubscribeGui = () => {};
        let unsubscribeEnd = () => {};
        let timer = null;

        const cleanup = () => {
            if (timer) clearTimeout(timer);
            timer = null;
            unsubscribeGui();
            unsubscribeEnd();
            unsubscribeCancellation();
            unsubscribeGui = () => {};
            unsubscribeEnd = () => {};
            unsubscribeCancellation = () => {};
        };

        const promise = new Promise((resolve, reject) => {
            rejectPromise = reject;

            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                cleanup();
                callback(value);
            };

            unsubscribeGui = this.eventBus.on('gui:opened', event => {
                if (event.botId !== this.botId) return;
                if (normalizeConnectionGeneration(event) !== expectedGeneration) return;
                if (!this.#isCurrent(expectedGeneration)) return;
                if (event.sessionId === previousSessionId) return;
                if (definitionId && event.definitionId && event.definitionId !== definitionId) return;

                const session = this.guiManager.current();
                if (!session || session.id !== event.sessionId) return;
                finish(resolve, session);
            });
            unsubscribeEnd = this.eventBus.on('connection:ended', event => {
                if (event.botId !== this.botId || normalizeConnectionGeneration(event) !== expectedGeneration) return;
                finish(reject, new FlowError('Connection ended while waiting for skyblock GUI.', {
                    code: 'DISCONNECTED', subsystem: 'skyblock', operation: 'SkyblockJoinOperation',
                    step: 'wait-gui', retryable: true, details: { expectedGeneration, label }
                }));
            });

            timer = setTimeout(() => {
                finish(reject, new TimeoutError(`Timed out waiting for ${label}.`));
            }, timeoutMs);

            if (cancellationToken) {
                unsubscribeCancellation = cancellationToken.onCancelled(reason => {
                    finish(
                        reject,
                        new OperationCancelledError(String(reason || 'Skyblock join cancelled.'))
                    );
                });
            }
        });

        const observation = promise.then(
            () => null,
            error => error
        );

        return {
            promise,
            observation,
            cancel(reason) {
                if (settled) return;
                settled = true;
                cleanup();
                rejectPromise(new OperationCancelledError(reason));
            }
        };
    }

    async #cancelWait(waiter, reason) {
        if (!waiter) return;
        waiter.cancel(reason);
        await waiter.observation;
    }

    #expectedGeneration(expectedGeneration, operationContext) {
        const candidate = expectedGeneration ?? operationContext?.connectionGeneration ?? this.context?.getGeneration?.();
        const generation = Number(candidate);
        if (!Number.isInteger(generation) || generation <= 0) {
            throw new FlowError('Skyblock join requires a connection generation.', {
                code: 'SKYBLOCK_GENERATION_REQUIRED', subsystem: 'skyblock', operation: 'SkyblockJoinOperation',
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
        throw new FlowError('Skyblock join belongs to a stale connection generation.', {
            code: 'DISCONNECTED', subsystem: 'skyblock', operation: 'SkyblockJoinOperation',
            step: 'generation-guard', retryable: true,
            details: { expectedGeneration: generation, currentGeneration: this.context?.getGeneration?.() ?? null }
        });
    }

    #validateConfig(config) {
        if (!config || typeof config !== 'object') {
            throw new TypeError('skyblock config is required');
        }
        if (typeof config.commandKey !== 'string' || !config.commandKey.trim()) {
            throw new Error('skyblock.commandKey is required');
        }
        if (!config.selections || typeof config.selections !== 'object') {
            throw new Error('skyblock.selections is required');
        }
        if (typeof config.defaultSelection !== 'string' || !config.selections[config.defaultSelection]) {
            throw new Error('skyblock.defaultSelection must reference a configured selection');
        }

        const selections = {};
        for (const [selectionId, selection] of Object.entries(config.selections)) {
            if (!selection || !Number.isInteger(selection.slot) || selection.slot < 0) {
                throw new Error(`skyblock.selections.${selectionId}.slot must be a non-negative integer`);
            }
            selections[selectionId] = Object.freeze({ slot: selection.slot });
        }

        if (!Number.isInteger(config.joinSlot) || config.joinSlot < 0) {
            throw new Error('skyblock.joinSlot must be a non-negative integer');
        }

        const guiTimeoutMs = this.#positive(config.guiTimeoutMs, 'skyblock.guiTimeoutMs');
        const clickTimeoutMs = this.#positive(config.clickTimeoutMs, 'skyblock.clickTimeoutMs');
        const slotReadyTimeoutMs = config.slotReadyTimeoutMs === undefined
            ? guiTimeoutMs
            : this.#positive(config.slotReadyTimeoutMs, 'skyblock.slotReadyTimeoutMs');
        const postJoinTimeoutMs = config.postJoinTimeoutMs === undefined
            ? 7000
            : this.#positive(config.postJoinTimeoutMs, 'skyblock.postJoinTimeoutMs');
        const postJoinMinPositionDelta = config.postJoinMinPositionDelta === undefined
            ? 4
            : this.#positive(config.postJoinMinPositionDelta, 'skyblock.postJoinMinPositionDelta');
        const selectionSettleMs = this.#nonNegative(
            config.selectionSettleMs === undefined ? 300 : config.selectionSettleMs,
            'skyblock.selectionSettleMs'
        );
        const joinSettleMs = this.#nonNegative(
            config.joinSettleMs === undefined ? 400 : config.joinSettleMs,
            'skyblock.joinSettleMs'
        );

        for (const key of ['entryGuiId', 'joinGuiId']) {
            if (config[key] !== null && config[key] !== undefined
                && (typeof config[key] !== 'string' || !config[key].trim())) {
                throw new Error(`skyblock.${key} must be null or a non-empty string`);
            }
        }

        return Object.freeze({
            commandKey: config.commandKey.trim(),
            selections: Object.freeze(selections),
            defaultSelection: config.defaultSelection,
            joinSlot: config.joinSlot,
            entryGuiId: config.entryGuiId || null,
            joinGuiId: config.joinGuiId || null,
            guiTimeoutMs,
            clickTimeoutMs,
            slotReadyTimeoutMs,
            selectionSettleMs,
            joinSettleMs,
            postJoinTimeoutMs,
            postJoinMinPositionDelta
        });
    }

    #positive(value, label) {
        if (!Number.isFinite(value) || value <= 0) {
            throw new Error(`${label} must be a positive number`);
        }
        return value;
    }

    #nonNegative(value, label) {
        if (!Number.isFinite(value) || value < 0) {
            throw new Error(`${label} must be a non-negative number`);
        }
        return value;
    }
}

module.exports = SkyblockJoinOperation;
