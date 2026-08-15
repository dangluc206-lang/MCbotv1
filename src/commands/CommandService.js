'use strict';

const Result = require('../shared/result/Result');
const Status = require('../shared/result/Status');
const FlowError = require('../shared/errors/FlowError');

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
        sensitive = false
    } = {}) {
        let command = null;
        try {
            command = this.resolver.resolve(key, args);
            const sent = await this.executor.execute(command, {
                sensitive,
                cancellationToken,
                expectedGeneration
            });
            if (confirm && this.confirmation && this.responseRules[key]) {
                const confirmed = await this.confirmation.wait({
                    botId: this.botId,
                    rules: this.responseRules[key],
                    timeoutMs,
                    cancellationToken
                });
                return Result.ok({ sent, confirmed }, { commandKey: key, command: sensitive ? '[REDACTED]' : command });
            }
            return Result.ok({ sent }, { commandKey: key, command: sensitive ? '[REDACTED]' : command });
        } catch (error) {
            const cancelled = error?.code === Status.CANCELLED;
            const timedOut = error?.code === Status.TIMEOUT;
            const staleGeneration = error?.code === 'COMMAND_STALE_GENERATION';
            const wrapped = FlowError.wrap(error, {
                code: cancelled
                    ? Status.CANCELLED
                    : (timedOut ? 'COMMAND_CONFIRM_TIMEOUT' : (staleGeneration ? 'COMMAND_STALE_GENERATION' : 'COMMAND_SEND_FAILED')),
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
                    expectedGeneration
                }
            });
            const status = cancelled ? Status.CANCELLED : (timedOut ? Status.TIMEOUT : Status.FAILED);
            return Result.fail(status, wrapped.message, wrapped, wrapped.toDiagnostic());
        }
    }
}

module.exports = CommandService;
