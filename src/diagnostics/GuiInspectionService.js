'use strict';

const Operation = require('../operations/Operation');
const FlowError = require('../shared/errors/FlowError');
const TimeoutError = require('../shared/errors/TimeoutError');
const { normalizeConnectionGeneration } = require('../core/events/EventEnvelope');

class GuiInspectionService {
    constructor({
        botId,
        context,
        eventBus,
        commandService,
        guiManager,
        serializer,
        operationManager = null,
        observationService = null,
        logger = null
    }) {
        Object.assign(this, {
            botId, context, eventBus, commandService, guiManager, serializer,
            operationManager, observationService, logger
        });
    }

    async capture({
        commandKey,
        commandDisplay,
        slots = [],
        timeoutMs = 7000,
        cancellationToken = null,
        expectedGeneration = null,
        operationContext = null,
        correlationId = null
    }) {
        this.#validate({ commandKey, slots, timeoutMs });
        const generation = Number(expectedGeneration ?? operationContext?.connectionGeneration ?? this.context.getGeneration());
        if (!Number.isInteger(generation) || generation <= 0 || !this.#isCurrent(generation)) {
            throw new FlowError(`Bot is not connected for GUI inspection: ${this.botId}`, {
                code: 'DISCONNECTED', subsystem: 'diagnostics', operation: 'GuiInspectionService',
                step: 'generation-guard', retryable: true, details: { expectedGeneration: generation }
            });
        }

        if (!this.operationManager) {
            return this.#capture({ commandKey, commandDisplay, slots, timeoutMs, cancellationToken, expectedGeneration: generation, operationContext });
        }
        const operation = new Operation({
            name: 'GuiInspectionService.capture',
            lockKeys: ['gui'],
            execute: context => this.#capture({
                commandKey, commandDisplay, slots, timeoutMs,
                cancellationToken: context.cancellation.token,
                expectedGeneration: context.connectionGeneration,
                operationContext: context
            })
        });
        const result = await this.operationManager.run(operation, {
            operationContext,
            cancellationToken,
            connectionGeneration: generation,
            timeoutMs,
            correlationId,
            metadata: { subsystem: 'diagnostics', commandKey, slots }
        });
        if (!result.success) throw result.error || new Error(result.message || 'GUI inspection failed.');
        return result.data;
    }

    async #capture({ commandKey, commandDisplay, slots, timeoutMs, cancellationToken, expectedGeneration, operationContext }) {
        cancellationToken?.throwIfCancelled?.();
        this.#assertCurrent(expectedGeneration);

        const opened = await this.#performAndWaitForOpen(
            () => this.commandService.send(commandKey, {
                confirm: false,
                cancellationToken,
                expectedGeneration,
                operationId: operationContext?.operationId || null,
                correlationId: operationContext?.correlationId || null
            }),
            {
                timeoutMs,
                cancellationToken,
                expectedGeneration,
                label: commandDisplay || commandKey,
                source: { commandKey, command: commandDisplay, clicks: [], source: 'discord-gui' }
            }
        );
        let session = opened.session;
        this.#assertCurrent(expectedGeneration);

        await this.observationService?.observeSession(session, {
            source: { commandKey, command: commandDisplay, clicks: [], source: 'discord-gui' }
        });

        for (let index = 0; index < slots.length; index += 1) {
            cancellationToken?.throwIfCancelled?.();
            this.#assertCurrent(expectedGeneration);
            const slot = slots[index];
            await this.guiManager.click(slot, {
                timeoutMs,
                cancellationToken,
                expectedGeneration,
                operationId: operationContext?.operationId || null,
                correlationId: operationContext?.correlationId || null
            });
            this.#assertCurrent(expectedGeneration);
            session = this.guiManager.current();
            if (!session) session = await this.guiManager.waitFor(null, timeoutMs, cancellationToken, expectedGeneration);
            if (Number(session.connectionGeneration) !== expectedGeneration) {
                throw new FlowError('GUI inspection observed a stale session.', {
                    code: 'DISCONNECTED', subsystem: 'diagnostics', operation: 'GuiInspectionService',
                    step: 'click-transition', retryable: true,
                    details: { expectedGeneration, actualGeneration: session.connectionGeneration ?? null }
                });
            }
            await this.observationService?.observeSession(session, {
                source: { commandKey, command: commandDisplay, clicks: slots.slice(0, index + 1), source: 'discord-gui' }
            });
            this.logger?.debug?.('GUI inspection click completed.', {
                botId: this.botId, step: index + 1, slot,
                sessionId: session.id, definitionId: session.definitionId || null
            });
        }

        cancellationToken?.throwIfCancelled?.();
        this.#assertCurrent(expectedGeneration);
        session = this.guiManager.current() || session;
        if (!session?.window) throw new Error('No active GUI after inspection clicks.');
        const snapshot = this.serializer.serialize({
            botId: this.botId,
            commandKey,
            commandDisplay,
            connectionGeneration: expectedGeneration,
            session
        });
        const output = Object.freeze({ ...snapshot, clicks: Object.freeze([...slots]) });
        this.logger?.info?.('GUI inspection captured.', {
            botId: this.botId, commandKey, clicks: slots,
            sessionId: session.id, title: output.gui.title, itemCount: output.items.length
        });
        return output;
    }

    #performAndWaitForOpen(action, options) {
        if (typeof this.guiManager.performAndWaitForOpen === 'function') {
            return this.guiManager.performAndWaitForOpen(action, options);
        }

        const previousSessionId = this.guiManager.current?.()?.id || null;
        const waiter = this.#armNextGui(previousSessionId, options);
        return Promise.resolve()
            .then(action)
            .then(async result => {
                if (result?.success === false) {
                    waiter.cancel('GUI inspection command failed.');
                    await Promise.allSettled([waiter.promise]);
                    throw result.error || new Error(result.message || 'GUI inspection command failed.');
                }
                return { session: await waiter.promise, result };
            }, async error => {
                waiter.cancel('GUI inspection command failed.');
                await Promise.allSettled([waiter.promise]);
                throw error;
            });
    }

    #armNextGui(previousSessionId, { timeoutMs, cancellationToken, expectedGeneration }) {
        let settled = false;
        let rejectPromise = null;
        let timer = null;
        let unsubscribeOpen = () => {};
        let unsubscribeEnd = () => {};
        let unsubscribeCancellation = () => {};

        const cleanup = () => {
            if (timer) clearTimeout(timer);
            timer = null;
            unsubscribeOpen();
            unsubscribeEnd();
            unsubscribeCancellation();
            unsubscribeOpen = unsubscribeEnd = unsubscribeCancellation = () => {};
        };
        const promise = new Promise((resolve, reject) => {
            rejectPromise = reject;
            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                cleanup();
                callback(value);
            };
            unsubscribeOpen = this.eventBus.on('gui:opened', event => {
                if (event?.botId !== this.botId) return;
                if (normalizeConnectionGeneration(event) !== Number(expectedGeneration)) return;
                if (!this.#isCurrent(expectedGeneration)) return;
                if (event?.sessionId === previousSessionId) return;
                const session = this.guiManager.current?.();
                if (!session || session.id !== event.sessionId) return;
                if (Number(session.connectionGeneration) !== Number(expectedGeneration)) return;
                finish(resolve, session);
            });
            unsubscribeEnd = this.eventBus.on('connection:ended', event => {
                if (event?.botId !== this.botId) return;
                if (normalizeConnectionGeneration(event) !== Number(expectedGeneration)) return;
                finish(reject, new FlowError('Connection ended while waiting for GUI inspection.', {
                    code: 'DISCONNECTED', subsystem: 'diagnostics', operation: 'GuiInspectionService',
                    step: 'wait-gui', retryable: true, details: { expectedGeneration }
                }));
            });
            unsubscribeCancellation = cancellationToken?.onCancelled?.(reason => {
                const error = new FlowError(String(reason?.message || reason || 'GUI inspection cancelled.'), {
                    code: 'CANCELLED', subsystem: 'diagnostics', operation: 'GuiInspectionService',
                    step: 'wait-gui', retryable: true, details: { expectedGeneration }
                });
                finish(reject, error);
            }) || (() => {});
            timer = setTimeout(() => finish(reject, new TimeoutError('Timed out waiting for GUI after command.')), timeoutMs);
        });

        return {
            promise,
            cancel(reason = 'GUI inspection cancelled.') {
                if (settled) return false;
                settled = true;
                cleanup();
                rejectPromise(new Error(String(reason)));
                return true;
            }
        };
    }

    #validate({ commandKey, slots, timeoutMs }) {
        if (!this.context.has()) throw new Error(`Bot is not connected: ${this.botId}`);
        if (typeof commandKey !== 'string' || !commandKey.trim()) throw new TypeError('commandKey is required.');
        if (!Array.isArray(slots) || slots.some(slot => !Number.isSafeInteger(slot) || slot < 0)) {
            throw new TypeError('slots must be an array of non-negative integers.');
        }
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive.');
    }

    #isCurrent(generation) {
        return this.context.has() && Number(this.context.getGeneration()) === Number(generation);
    }

    #assertCurrent(generation) {
        if (this.#isCurrent(generation)) return;
        throw new FlowError('GUI inspection belongs to a stale connection generation.', {
            code: 'DISCONNECTED', subsystem: 'diagnostics', operation: 'GuiInspectionService',
            step: 'generation-guard', retryable: true,
            details: { expectedGeneration: generation, currentGeneration: this.context.getGeneration() }
        });
    }
}

module.exports = GuiInspectionService;