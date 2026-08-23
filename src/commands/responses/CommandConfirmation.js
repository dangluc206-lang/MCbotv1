'use strict';

const TimeoutError = require('../../shared/errors/TimeoutError');
const OperationCancelledError = require('../../shared/errors/OperationCancelledError');
const FlowError = require('../../shared/errors/FlowError');
const { normalizeConnectionGeneration } = require('../../core/events/EventEnvelope');

class CommandConfirmation {
    constructor({ eventBus, matcher, context = null }) {
        this.eventBus = eventBus;
        this.matcher = matcher;
        this.context = context;
    }

    wait(options) { return this.arm(options).promise; }

    arm({
        botId,
        rules,
        timeoutMs = 5000,
        cancellationToken = null,
        expectedGeneration = null,
        operationId = null,
        correlationId = null
    }) {
        const expected = expectedGeneration == null ? null : Number(expectedGeneration);
        if (expected !== null && (!Number.isInteger(expected) || expected <= 0)) {
            throw new TypeError('expectedGeneration must be a positive integer when provided');
        }

        let settled = false;
        let rejectPromise = null;
        let timer = null;
        let cancelUnsubscribe = () => {};
        const subscriptions = [];

        const cleanup = () => {
            if (timer) clearTimeout(timer);
            timer = null;
            for (const off of subscriptions.splice(0)) off();
            cancelUnsubscribe();
            cancelUnsubscribe = () => {};
        };

        const promise = new Promise((resolve, reject) => {
            rejectPromise = reject;
            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                cleanup();
                callback(value);
            };

            subscriptions.push(this.eventBus.on('command:message', event => {
                if (event.botId !== botId) return;
                const generation = normalizeConnectionGeneration(event);
                if (expected !== null && generation !== expected) return;
                if (expected !== null && !this.#isCurrent(expected)) return;
                const result = this.matcher.match(event.message, rules);
                if (!result.matched) return;
                finish(resolve, Object.freeze({
                    message: event.message,
                    rule: result.rule,
                    connectionGeneration: generation,
                    eventId: event.eventId || null,
                    operationId,
                    correlationId
                }));
            }));

            subscriptions.push(this.eventBus.on('connection:ended', event => {
                if (event.botId !== botId || expected === null) return;
                if (normalizeConnectionGeneration(event) !== expected) return;
                finish(reject, new FlowError('Connection ended before command confirmation.', {
                    code: 'COMMAND_CONFIRM_DISCONNECTED', subsystem: 'command', operation: 'CommandConfirmation',
                    step: 'wait-response', retryable: true,
                    details: { expectedGeneration: expected, operationId, correlationId }
                }));
            }));

            timer = setTimeout(() => finish(reject, new TimeoutError('Command confirmation timed out.')), timeoutMs);
            if (cancellationToken) {
                cancelUnsubscribe = cancellationToken.onCancelled(reason => finish(reject,
                    new OperationCancelledError(String(reason || 'Operation cancelled.'))));
            }
        });

        const observation = promise.then(
            () => null,
            error => error
        );

        return Object.freeze({
            promise,
            observation,
            cancel(reason = 'Command confirmation cancelled.') {
                if (settled) return false;
                settled = true;
                cleanup();
                const error = reason instanceof Error ? reason : new OperationCancelledError(String(reason));
                rejectPromise(error);
                return true;
            }
        });
    }

    #isCurrent(expectedGeneration) {
        if (!this.context) return true;
        return this.context.has?.() !== false
            && Number(this.context.getGeneration?.()) === Number(expectedGeneration);
    }
}

module.exports = CommandConfirmation;