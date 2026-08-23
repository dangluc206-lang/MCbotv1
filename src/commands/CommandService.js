'use strict';

const Result = require('../shared/result/Result');
const Status = require('../shared/result/Status');
const FlowError = require('../shared/errors/FlowError');
const Operation = require('../operations/Operation');

class CommandService {
    constructor({ botId, resolver, executor, confirmation = null, responseRules = {} }) {
        Object.assign(this, { botId, resolver, executor, confirmation, responseRules });
    }

    async send(key, {
        args = {},
        confirm = true,
        timeoutMs = 5000,
        cancellationToken = null,
        expectedGeneration = null,
        sensitive = false,
        operationId = null,
        correlationId = null
    } = {}) {
        let command = null;
        let confirmationWaiter = null;
        try {
            command = this.resolver.resolve(key, args);
            if (confirm && this.confirmation && this.responseRules[key]) {
                const confirmationOptions = {
                    botId: this.botId,
                    rules: this.responseRules[key],
                    timeoutMs,
                    cancellationToken,
                    expectedGeneration,
                    operationId,
                    correlationId
                };
                confirmationWaiter = typeof this.confirmation.arm === 'function'
                    ? this.confirmation.arm(confirmationOptions)
                    : (() => {
                        const promise = this.confirmation.wait(confirmationOptions);
                        return Object.freeze({
                            promise,
                            observation: promise.then(() => null, error => error),
                            cancel: () => false
                        });
                    })();
            }
            const sent = await this.executor.execute(command, {
                sensitive,
                cancellationToken,
                expectedGeneration
            });
            if (confirmationWaiter) {
                const confirmed = await confirmationWaiter.promise;
                return Result.ok({ sent, confirmed }, { commandKey: key, command: sensitive ? '[REDACTED]' : command });
            }
            return Result.ok({ sent }, { commandKey: key, command: sensitive ? '[REDACTED]' : command });
        } catch (error) {
            if (confirmationWaiter) {
                confirmationWaiter.cancel(error);
                await (confirmationWaiter.observation || Promise.allSettled([confirmationWaiter.promise]));
            }
            const cancelled = error?.code === Status.CANCELLED;
            const timedOut = error?.code === Status.TIMEOUT;
            const staleGeneration = error?.code === 'COMMAND_STALE_GENERATION';
            const confirmationDisconnected = error?.code === 'COMMAND_CONFIRM_DISCONNECTED';
            const disconnected = staleGeneration || confirmationDisconnected;
            const classifiedStatus = Operation.statusForError(error);
            const preserveClassifiedError = classifiedStatus !== Status.FAILED;
            const wrapped = FlowError.wrap(error, {
                code: cancelled
                    ? Status.CANCELLED
                    : (timedOut
                        ? 'COMMAND_CONFIRM_TIMEOUT'
                        : (disconnected
                            ? error.code
                            : (preserveClassifiedError ? error?.code : 'COMMAND_SEND_FAILED'))),
                subsystem: 'command',
                operation: 'CommandService',
                step: confirm ? 'send-and-confirm' : 'send',
                action: sensitive ? '[REDACTED]' : (command || key),
                resource: key,
                details: {
                    commandKey: key,
                    args: sensitive ? '[REDACTED]' : args,
                    timeoutMs,
                    confirm,
                    expectedGeneration,
                    operationId,
                    correlationId
                }
            });
            const status = cancelled
                ? Status.CANCELLED
                : (timedOut
                    ? Status.TIMEOUT
                    : (disconnected
                        ? Status.DISCONNECTED
                        : (preserveClassifiedError ? classifiedStatus : Status.FAILED)));
            return Result.fail(status, wrapped.message, wrapped, wrapped.toDiagnostic());
        }
    }
}

module.exports = CommandService;
