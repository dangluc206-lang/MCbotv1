'use strict';

const Timeout = require('../shared/time/Timeout');
const FlowError = require('../shared/errors/FlowError');

class CommandExecutor {
    constructor({ context, guard }) {
        this.context = context;
        this.guard = guard;
    }

    async execute(command, {
        sensitive = false,
        cancellationToken = null,
        expectedGeneration = null
    } = {}) {
        cancellationToken?.throwIfCancelled?.();

        const capturedClient = this.context.require();
        const capturedGeneration = this.#generation();
        this.#assertExpectedGeneration(expectedGeneration, capturedGeneration, capturedClient, 'before-throttle');

        const wait = this.guard.assert(command);
        if (wait) await Timeout.delay(wait, { cancellationToken });

        // Cancellation and connection identity are checked again after throttle.
        // No await is allowed between the final checks and bot.chat().
        cancellationToken?.throwIfCancelled?.();
        const bot = this.context.require();
        const currentGeneration = this.#generation();
        this.#assertExpectedGeneration(expectedGeneration, currentGeneration, capturedClient, 'before-chat', bot);
        cancellationToken?.throwIfCancelled?.();

        bot.chat(command);
        this.guard.markSent();
        return {
            command: sensitive ? '[REDACTED]' : command,
            sentAt: Date.now(),
            sensitive: Boolean(sensitive)
        };
    }

    #generation() {
        const value = this.context.getGeneration?.();
        const generation = Number(value);
        return Number.isFinite(generation) ? generation : null;
    }

    #assertExpectedGeneration(expectedGeneration, currentGeneration, capturedClient, step, currentClient = capturedClient) {
        if (expectedGeneration === null || expectedGeneration === undefined) return;
        const expected = Number(expectedGeneration);
        if (!Number.isFinite(expected)) {
            throw new TypeError('expectedGeneration must be a finite number when provided');
        }
        if (currentGeneration === expected && currentClient === capturedClient) return;
        throw new FlowError('Command connection generation changed before send.', {
            code: 'COMMAND_STALE_GENERATION',
            subsystem: 'command',
            operation: 'CommandExecutor',
            step,
            action: 'send server command',
            retryable: true,
            details: {
                expectedGeneration: expected,
                currentGeneration,
                clientReplaced: currentClient !== capturedClient
            }
        });
    }
}

module.exports = CommandExecutor;
