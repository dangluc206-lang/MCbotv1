'use strict';

const TimeoutError = require('../../shared/errors/TimeoutError');
const FlowError = require('../../shared/errors/FlowError');
const CancellationSource = require('../../shared/cancellation/CancellationSource');
const OperationCancellation = require('../../operations/OperationCancellation');
const Status = require('../../shared/result/Status');

class IslandTeleportOperation {
    constructor({ commandService, positionService, eventBus, connectionState, botId, config }) {
        if (!eventBus) throw new TypeError('eventBus is required for teleport verification');
        if (!connectionState || typeof connectionState.generation !== 'function' || typeof connectionState.isConnected !== 'function') {
            throw new TypeError('connectionState is required for generation-aware island teleport verification');
        }
        if (!config || typeof config !== 'object') throw new TypeError('island config is required');
        if (typeof config.commandKey !== 'string' || !config.commandKey) throw new Error('island.commandKey is required');
        if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0) throw new Error('island.timeoutMs must be positive');
        Object.assign(this, { commandService, positionService, eventBus, connectionState, botId, config });
    }

    async execute({ cancellationToken = null } = {}) {
        const before = this.positionService.current();
        const expectedGeneration = Number(this.connectionState.generation());
        let stage = 'send-command';
        let waiter = null;
        const commandCancellation = new CancellationSource();
        const unlinkParentCancellation = OperationCancellation.link(cancellationToken, commandCancellation);

        try {
            cancellationToken?.throwIfCancelled?.();
            this.#assertGeneration(expectedGeneration, 'capture-generation');

            // Bind the waiter before sending the command so a very fast
            // forcedMove cannot be missed. Promise.all observes both branches:
            // a command failure cannot orphan the waiter, and a stale-generation
            // waiter failure cannot leave a command rejection unobserved.
            waiter = this.#createTeleportWaiter({
                expectedGeneration,
                cancellationToken,
                abortCommand: reason => commandCancellation.cancel(reason?.message || reason || 'Island teleport verification ended.')
            });
            const commandTask = (async () => {
                commandCancellation.token.throwIfCancelled();
                this.#assertGeneration(expectedGeneration, 'send-command');
                const sent = await this.commandService.send(this.config.commandKey, {
                    confirm: false,
                    cancellationToken: commandCancellation.token,
                    expectedGeneration
                });
                this.#assertGeneration(expectedGeneration, 'send-command-complete');
                if (!sent.success) {
                    if (sent.status === Status.CANCELLED || sent.error?.code === Status.CANCELLED) {
                        throw sent.error || new FlowError(sent.message || 'Island command cancelled.', {
                            code: Status.CANCELLED,
                            subsystem: 'island',
                            operation: 'IslandTeleportOperation',
                            step: 'send-command'
                        });
                    }
                    if (sent.error?.code === 'COMMAND_STALE_GENERATION') {
                        throw this.#staleGeneration(expectedGeneration, 'send-command-stale-generation');
                    }
                    throw FlowError.fromResult(sent, {
                        code: 'ISLAND_COMMAND_FAILED',
                        subsystem: 'island',
                        operation: 'IslandTeleportOperation',
                        step: 'send-command',
                        action: 'send /is',
                        resource: this.config.commandKey,
                        details: { before, expectedGeneration }
                    });
                }
                return sent;
            })();

            stage = 'verify-teleport';
            const [, event] = await Promise.all([commandTask, waiter.promise]);
            this.#assertGeneration(expectedGeneration, 'return-success');
            return { before, after: event.position, connectionGeneration: expectedGeneration };
        } catch (error) {
            commandCancellation.cancel(error?.message || 'Island teleport operation failed.');
            // If the command branch fails first, explicitly settle the waiter
            // as well as disposing its resources. Promise.all already observes
            // waiter.promise, so this cannot create a secondary unhandled rejection.
            waiter?.cancel?.(error);
            if (error?.code === 'CANCELLED') throw error;
            if (error instanceof FlowError) throw error;
            const isTimeout = error instanceof TimeoutError;
            throw FlowError.wrap(error, {
                code: isTimeout ? 'ISLAND_TELEPORT_VERIFY_TIMEOUT' : 'ISLAND_TELEPORT_FAILED',
                subsystem: 'island',
                operation: 'IslandTeleportOperation',
                step: stage,
                action: stage === 'send-command' ? 'send /is' : 'wait for movement:teleport',
                resource: this.config.commandKey,
                details: {
                    before,
                    expectedGeneration,
                    timeoutMs: this.config.timeoutMs,
                    currentPosition: this.positionService.current()
                }
            });
        } finally {
            commandCancellation.cancel('Island teleport operation settled.');
            waiter?.dispose?.();
            unlinkParentCancellation();
            commandCancellation.dispose();
        }
    }

    #createTeleportWaiter({ expectedGeneration, cancellationToken = null, abortCommand = null }) {
        let cancel = () => {};
        let dispose = () => {};
        const promise = new Promise((resolve, reject) => {
            let done = false;
            let timer = null;
            let unsubscribeCancel = () => {};
            const unsubscribers = [];
            const cleanup = () => {
                if (timer) clearTimeout(timer);
                timer = null;
                for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
                unsubscribeCancel();
                unsubscribeCancel = () => {};
            };
            const finish = (callback, value) => {
                if (done) return;
                done = true;
                cleanup();
                callback(value);
            };
            const rejectOperation = error => {
                abortCommand?.(error);
                finish(reject, error);
            };
            const rejectStale = step => rejectOperation(this.#staleGeneration(expectedGeneration, step));

            unsubscribers.push(this.eventBus.on('movement:teleport', event => {
                if (event?.botId !== this.botId) return;
                const eventGeneration = this.#eventGeneration(event);
                if (eventGeneration === null || eventGeneration !== expectedGeneration) return;
                if (!this.#isCurrentGeneration(expectedGeneration)) {
                    rejectStale('verify-teleport-event');
                    return;
                }
                finish(resolve, event);
            }));

            const onConnectionTransition = event => {
                if (event?.botId !== this.botId) return;
                if (!this.#isCurrentGeneration(expectedGeneration)) rejectStale('connection-transition');
            };
            for (const eventName of ['connection:client-attached', 'connection:spawned', 'connection:ended']) {
                unsubscribers.push(this.eventBus.on(eventName, onConnectionTransition));
            }

            timer = setTimeout(() => {
                rejectOperation(new TimeoutError('Island teleport was not verified.'));
            }, this.config.timeoutMs);
            if (cancellationToken?.onCancelled) {
                unsubscribeCancel = cancellationToken.onCancelled(reason => rejectOperation(new FlowError(String(reason || 'Island teleport cancelled.'), {
                    code: 'CANCELLED', subsystem: 'island', operation: 'IslandTeleportOperation', step: 'verify-teleport'
                })));
            }
            cancel = error => finish(reject, error instanceof Error ? error : new FlowError(String(error || 'Island teleport waiter cancelled.'), {
                code: 'CANCELLED', subsystem: 'island', operation: 'IslandTeleportOperation', step: 'verify-teleport'
            }));
            dispose = () => {
                if (done) return;
                done = true;
                cleanup();
            };
        });
        return { promise, cancel: error => cancel(error), dispose: () => dispose() };
    }

    #eventGeneration(event) {
        const value = event?.connectionGeneration ?? event?.generation;
        const generation = Number(value);
        return Number.isFinite(generation) ? generation : null;
    }

    #isCurrentGeneration(expectedGeneration) {
        return this.connectionState.isConnected()
            && Number(this.connectionState.generation()) === Number(expectedGeneration);
    }

    #assertGeneration(expectedGeneration, step) {
        if (Number.isFinite(Number(expectedGeneration)) && this.#isCurrentGeneration(expectedGeneration)) return;
        throw this.#staleGeneration(expectedGeneration, step);
    }

    #staleGeneration(expectedGeneration, step) {
        return new FlowError('Connection generation changed during island teleport.', {
            code: 'ISLAND_STALE_GENERATION',
            subsystem: 'island',
            operation: 'IslandTeleportOperation',
            step,
            action: 'verify /is connection generation',
            resource: this.config.commandKey,
            retryable: true,
            details: {
                expectedGeneration,
                currentGeneration: Number(this.connectionState.generation()),
                connected: Boolean(this.connectionState.isConnected())
            }
        });
    }
}

module.exports = IslandTeleportOperation;
