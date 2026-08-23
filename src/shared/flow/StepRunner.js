'use strict';

const Timeout = require('../time/Timeout');
const FlowError = require('../errors/FlowError');

class StepRunner {
    constructor({ operation = null, logger = null, trace = null } = {}) {
        this.operation = operation;
        this.logger = logger;
        this.trace = Array.isArray(trace) ? trace : [];
    }

    async run(meta, action, {
        retries = 0,
        retryDelayMs = 0,
        cancellationToken = null,
        acceptFailedResult = false
    } = {}) {
        if (typeof action !== 'function') throw new TypeError('step action must be a function');
        const normalized = this.#normalizeMeta(meta);
        const maxAttempts = Math.max(1, Number(retries) + 1);
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            cancellationToken?.throwIfCancelled?.();
            const startedAt = Date.now();
            const traceEntry = {
                step: normalized.step,
                action: normalized.action,
                resource: normalized.resource,
                attempt,
                startedAt
            };
            this.trace.push(traceEntry);
            this.logger?.info?.('STEP START', {
                operation: normalized.operation,
                step: normalized.step,
                action: normalized.action,
                resource: normalized.resource,
                attempt,
                maxAttempts,
                phase: 'START'
            });
            try {
                const value = await action({ attempt, maxAttempts });
                if (!acceptFailedResult && value?.success === false) {
                    throw FlowError.fromResult(value, {
                        subsystem: normalized.subsystem,
                        operation: normalized.operation,
                        step: normalized.step,
                        action: normalized.action,
                        resource: normalized.resource,
                        attempt,
                        details: normalized.details,
                        trace: this.trace
                    });
                }
                traceEntry.status = 'ok';
                traceEntry.elapsedMs = Date.now() - startedAt;
                this.logger?.info?.('STEP OK', {
                    operation: normalized.operation,
                    step: normalized.step,
                    action: normalized.action,
                    resource: normalized.resource,
                    attempt,
                    elapsedMs: traceEntry.elapsedMs,
                    phase: 'OK'
                });
                return value;
            } catch (error) {
                traceEntry.status = 'failed';
                traceEntry.elapsedMs = Date.now() - startedAt;
                traceEntry.error = error?.message || String(error);

                // A nested FlowError already contains the most precise (leaf) failure
                // context, e.g. CraftingOperation -> verify-output -> refined_diamond_block.
                // Do not overwrite that with the parent B5 step. Preserve the leaf at
                // top-level and append this runner's context as parentFlow instead.
                if (error instanceof FlowError) {
                    const existingParents = Array.isArray(error.details?.parentFlow)
                        ? error.details.parentFlow
                        : [];
                    const parentFlow = [...existingParents, {
                        subsystem: normalized.subsystem,
                        operation: normalized.operation,
                        step: normalized.step,
                        action: normalized.action,
                        resource: normalized.resource,
                        attempt,
                        details: normalized.details || null
                    }];
                    lastError = FlowError.wrap(error, {
                        details: { parentFlow },
                        trace: this.trace
                    });
                } else {
                    lastError = FlowError.wrap(error, {
                        subsystem: normalized.subsystem,
                        operation: normalized.operation,
                        step: normalized.step,
                        action: normalized.action,
                        resource: normalized.resource,
                        attempt,
                        details: normalized.details,
                        trace: this.trace
                    });
                }
                if (attempt >= maxAttempts || lastError.retryable === false) {
                    const terminalLog = lastError.code === 'CANCELLED' ? this.logger?.info : this.logger?.warn;
                    terminalLog?.call(this.logger, lastError.code === 'CANCELLED' ? 'STEP CANCELLED' : 'STEP FAIL', {
                        operation: normalized.operation,
                        step: normalized.step,
                        action: normalized.action,
                        resource: normalized.resource,
                        attempt,
                        elapsedMs: traceEntry.elapsedMs,
                        phase: 'FAIL',
                        code: lastError.code || null,
                        error: lastError.message
                    });
                    throw lastError;
                }
                this.logger?.warn?.('STEP RETRY', {
                    operation: normalized.operation,
                    step: normalized.step,
                    action: normalized.action,
                    resource: normalized.resource,
                    attempt,
                    maxAttempts,
                    error: lastError.message,
                    retryDelayMs,
                    phase: 'RETRY'
                });
                if (retryDelayMs > 0) await Timeout.delay(retryDelayMs, { cancellationToken });
            }
        }
        throw lastError || new FlowError('Flow step failed.', normalized);
    }

    #normalizeMeta(meta) {
        const value = typeof meta === 'string' ? { step: meta } : (meta || {});
        return {
            subsystem: value.subsystem || null,
            operation: value.operation || this.operation || null,
            step: value.step || 'unknown-step',
            action: value.action || null,
            resource: value.resource || null,
            details: value.details || null
        };
    }
}

module.exports = StepRunner;
