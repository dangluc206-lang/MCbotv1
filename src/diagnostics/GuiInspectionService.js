'use strict';

const TimeoutError = require('../shared/errors/TimeoutError');

class GuiInspectionService {
    constructor({
        botId,
        context,
        eventBus,
        commandService,
        guiManager,
        serializer,
        lockPolicy,
        observationService = null,
        logger = null
    }) {
        Object.assign(this, {
            botId,
            context,
            eventBus,
            commandService,
            guiManager,
            serializer,
            lockPolicy,
            observationService,
            logger
        });
    }

    async capture({ commandKey, commandDisplay, slots = [], timeoutMs = 7000 }) {
        if (!this.context.has()) throw new Error(`Bot is not connected: ${this.botId}`);
        if (typeof commandKey !== 'string' || !commandKey.trim()) {
            throw new TypeError('commandKey is required.');
        }
        if (!Array.isArray(slots) || slots.some(slot => !Number.isSafeInteger(slot) || slot < 0)) {
            throw new TypeError('slots must be an array of non-negative integers.');
        }
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            throw new TypeError('timeoutMs must be positive.');
        }

        const owner = `gui-inspection:${this.botId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        const lockKeys = ['gui', 'server-command'];
        if (!this.lockPolicy.acquire(lockKeys, owner)) {
            throw new Error('GUI inspection is blocked by another operation.');
        }

        let waiter = null;
        try {
            const previousSessionId = this.guiManager.current()?.id || null;
            waiter = this.#waitForNextGui(previousSessionId, timeoutMs);

            const sent = await this.commandService.send(commandKey, { confirm: false });
            if (!sent.success) {
                throw sent.error || new Error(sent.message || `Failed to send command: ${commandKey}`);
            }

            let session = await waiter.promise;
            waiter = null;

            // Persist the command root with a readable route name, e.g.
            // /sky -> sky.json, /ks -> ks.json, /pv 2 -> pv-2.json.
            await this.observationService?.observeSession(session, {
                source: { commandKey, command: commandDisplay, clicks: [], source: 'discord-gui' }
            });

            for (let index = 0; index < slots.length; index += 1) {
                const slot = slots[index];
                await this.guiManager.click(slot, { timeoutMs });

                // ClickVerifier có thể hoàn tất khi GUI cũ đóng trước khi GUI mới mở.
                // Nếu vậy, waitFor() sẽ đợi GUI kế tiếp; nếu GUI đã mở thì trả ngay.
                session = this.guiManager.current();
                if (!session) {
                    session = await this.guiManager.waitFor(null, timeoutMs);
                }

                await this.observationService?.observeSession(session, {
                    source: {
                        commandKey,
                        command: commandDisplay,
                        clicks: slots.slice(0, index + 1),
                        source: 'discord-gui'
                    }
                });

                this.logger?.debug?.('GUI inspection click completed.', {
                    botId: this.botId,
                    step: index + 1,
                    slot,
                    sessionId: session.id,
                    definitionId: session.definitionId || null
                });
            }

            // Chỉ serialize GUI hiện tại sau khi toàn bộ click đã hoàn tất.
            session = this.guiManager.current() || session;
            if (!session?.window) {
                throw new Error('No active GUI after inspection clicks.');
            }

            // Root/step observations above already saved the data using readable names.
            // When no observation service exists, Discord capture still works normally.
            const snapshot = this.serializer.serialize({
                botId: this.botId,
                commandKey,
                commandDisplay,
                connectionGeneration: this.context.getGeneration(),
                session
            });

            const output = Object.freeze({
                ...snapshot,
                clicks: Object.freeze([...slots])
            });

            this.logger?.info?.('GUI inspection captured.', {
                botId: this.botId,
                commandKey,
                clicks: slots,
                sessionId: session.id,
                title: output.gui.title,
                itemCount: output.items.length
            });

            return output;
        } finally {
            if (waiter) {
                waiter.cancel('GUI inspection cancelled.');
                await waiter.promise.catch(() => {});
            }
            this.lockPolicy.release(lockKeys, owner);
        }
    }

    #waitForNextGui(previousSessionId, timeoutMs) {
        let settled = false;
        let rejectPromise = null;
        let timer = null;
        let unsubscribe = () => {};

        const cleanup = () => {
            if (timer) clearTimeout(timer);
            timer = null;
            unsubscribe();
            unsubscribe = () => {};
        };

        const promise = new Promise((resolve, reject) => {
            rejectPromise = reject;
            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                cleanup();
                callback(value);
            };

            unsubscribe = this.eventBus.on('gui:opened', event => {
                if (event.botId !== this.botId) return;
                if (event.sessionId === previousSessionId) return;
                const session = this.guiManager.current();
                if (!session || session.id !== event.sessionId) return;
                finish(resolve, session);
            });

            timer = setTimeout(() => {
                finish(reject, new TimeoutError('Timed out waiting for GUI after command.'));
            }, timeoutMs);
        });

        return {
            promise,
            cancel(reason) {
                if (settled) return;
                settled = true;
                cleanup();
                rejectPromise(new Error(reason));
            }
        };
    }
}

module.exports = GuiInspectionService;
