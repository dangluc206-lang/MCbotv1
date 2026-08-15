'use strict';

const Timeout = require('../../shared/time/Timeout');
const TimeoutError = require('../../shared/errors/TimeoutError');
const OperationCancelledError = require('../../shared/errors/OperationCancelledError');

class SkyblockJoinOperation {
    constructor({
        botId,
        commandService,
        guiManager,
        guiKnowledge = null,
        eventBus,
        lockPolicy,
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
        if (!lockPolicy || typeof lockPolicy.acquire !== 'function' || typeof lockPolicy.release !== 'function') {
            throw new TypeError('lockPolicy is required');
        }

        this.botId = botId;
        this.commandService = commandService;
        this.guiManager = guiManager;
        this.guiKnowledge = guiKnowledge;
        this.eventBus = eventBus;
        this.lockPolicy = lockPolicy;
        this.config = this.#validateConfig(config);
    }

    async execute(selectionId = null, { cancellationToken = null } = {}) {
        cancellationToken?.throwIfCancelled?.();

        const resolvedSelectionId = selectionId || this.config.defaultSelection;
        const selection = this.config.selections[resolvedSelectionId];
        if (!selection) {
            throw new RangeError(`Unknown skyblock selection: ${resolvedSelectionId}`);
        }

        const owner = `skyblock-join:${this.botId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        const lockKeys = ['gui', 'movement', 'server-command', 'teleport'];
        if (!this.lockPolicy.acquire(lockKeys, owner)) {
            throw new Error('Skyblock join is blocked by another operation.');
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
                label: 'skyblock selection GUI'
            });

            const sent = await this.commandService.send(this.config.commandKey, {
                confirm: false,
                cancellationToken
            });
            if (!sent.success) {
                throw sent.error || new Error(sent.message || 'Skyblock command failed.');
            }

            const selectionSession = await firstWait.promise;
            firstWait = null;

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
                label: `skyblock selection slot ${selectionSlot}`
            });
            await Timeout.delay(this.config.selectionSettleMs, { cancellationToken });

            secondWait = this.#createGuiWait({
                previousSessionId: selectionSession.id,
                definitionId: this.config.joinGuiId,
                timeoutMs: this.config.guiTimeoutMs,
                cancellationToken,
                label: 'skyblock join GUI'
            });

            await this.guiManager.click(selectionSlot, {
                timeoutMs: this.config.clickTimeoutMs
            });

            const joinSession = await secondWait.promise;
            secondWait = null;

            // Same rule for the second /sky GUI: this is shared server
            // structure, not account-specific state. /kho, inventory and /pv 2
            // may differ per account, but /sky must use the configured slot.
            const joinSlot = this.config.joinSlot;

            await this.#waitForSlotReady({
                sessionId: joinSession.id,
                slot: joinSlot,
                timeoutMs: this.config.slotReadyTimeoutMs,
                cancellationToken,
                label: `skyblock join slot ${joinSlot}`
            });
            await Timeout.delay(this.config.joinSettleMs, { cancellationToken });

            // Arm teleport verification BEFORE clicking the final join slot so a fast
            // position packet cannot race past the listener.
            teleportWait = this.#createTeleportWait({
                timeoutMs: this.config.postJoinTimeoutMs,
                cancellationToken
            });

            await this.guiManager.click(joinSlot, {
                timeoutMs: this.config.clickTimeoutMs
            });

            const teleport = await teleportWait.promise;
            teleportWait = null;

            return Object.freeze({
                selectionId: resolvedSelectionId,
                selectionSlot,
                joinSlot,
                selectionSessionId: selectionSession.id,
                joinSessionId: joinSession.id,
                verified: 'movement:teleport',
                position: teleport.position || null
            });
        } finally {
            await this.#cancelWait(firstWait, 'Skyblock selection wait cancelled.');
            await this.#cancelWait(secondWait, 'Skyblock join wait cancelled.');
            await this.#cancelWait(teleportWait, 'Skyblock teleport wait cancelled.');
            this.lockPolicy.release(lockKeys, owner);
        }
    }

    async #waitForSlotReady({
        sessionId,
        slot,
        timeoutMs,
        cancellationToken,
        label
    }) {
        const deadline = Date.now() + timeoutMs;

        while (Date.now() <= deadline) {
            cancellationToken?.throwIfCancelled?.();
            const session = this.guiManager.current();
            if (session?.id === sessionId) {
                const item = session.window?.slots?.[slot];
                if (item) return item;
            }
            await Timeout.delay(50, { cancellationToken });
        }

        throw new TimeoutError(`Timed out waiting for ${label} to contain an item.`);
    }

    #createTeleportWait({ timeoutMs, cancellationToken }) {
        let settled = false;
        let rejectPromise = null;
        let unsubscribeCancellation = () => {};
        let unsubscribeTeleport = () => {};
        let timer = null;

        const cleanup = () => {
            if (timer) clearTimeout(timer);
            timer = null;
            unsubscribeTeleport();
            unsubscribeCancellation();
            unsubscribeTeleport = () => {};
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

            unsubscribeTeleport = this.eventBus.on('movement:teleport', event => {
                if (event.botId !== this.botId) return;
                finish(resolve, event);
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

        return {
            promise,
            cancel(reason) {
                if (settled) return;
                settled = true;
                cleanup();
                rejectPromise(new OperationCancelledError(reason));
            }
        };
    }

    #createGuiWait({
        previousSessionId,
        definitionId,
        timeoutMs,
        cancellationToken,
        label
    }) {
        let settled = false;
        let rejectPromise = null;
        let unsubscribeCancellation = () => {};
        let unsubscribeGui = () => {};
        let timer = null;

        const cleanup = () => {
            if (timer) clearTimeout(timer);
            timer = null;
            unsubscribeGui();
            unsubscribeCancellation();
            unsubscribeGui = () => {};
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
                if (event.sessionId === previousSessionId) return;
                if (definitionId && event.definitionId && event.definitionId !== definitionId) return;

                const session = this.guiManager.current();
                if (!session || session.id !== event.sessionId) return;
                finish(resolve, session);
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

        return {
            promise,
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
        await waiter.promise.catch(() => {});
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
            postJoinTimeoutMs
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
