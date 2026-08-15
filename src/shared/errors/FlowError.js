'use strict';

const AppError = require('./AppError');
const Redactor = require('../security/Redactor');

function clean(value) {
    return Redactor.sanitize(value);
}

function errorDiagnostic(error) {
    if (!error) return null;
    if (typeof error.toDiagnostic === 'function') return error.toDiagnostic();
    return {
        name: error.name || 'Error',
        message: Redactor.redactText(error.message || String(error)),
        code: error.code || null,
        details: clean(error.details ?? null),
        stack: Redactor.redactText(error.stack || '') || null
    };
}

class FlowError extends AppError {
    constructor(message, {
        code = 'FLOW_STEP_FAILED',
        subsystem = null,
        operation = null,
        step = null,
        action = null,
        resource = null,
        retryable = true,
        attempt = null,
        details = null,
        trace = null,
        cause = null
    } = {}) {
        super(message, { name: 'FlowError', code, details, cause });
        this.subsystem = subsystem;
        this.operation = operation;
        this.step = step;
        this.action = action;
        this.resource = resource;
        this.retryable = retryable !== false;
        this.attempt = Number.isInteger(attempt) ? attempt : null;
        this.trace = Array.isArray(trace) ? trace.map(entry => clean(entry)) : [];
    }

    toDiagnostic() {
        return clean({
            name: this.name,
            code: this.code,
            message: this.message,
            subsystem: this.subsystem,
            operation: this.operation,
            step: this.step,
            action: this.action,
            resource: this.resource,
            retryable: this.retryable,
            attempt: this.attempt,
            details: this.details,
            trace: this.trace,
            cause: this.cause ? errorDiagnostic(this.cause) : null
        });
    }

    static wrap(error, context = {}) {
        if (error instanceof FlowError) {
            const merged = {
                subsystem: context.subsystem ?? error.subsystem,
                operation: context.operation ?? error.operation,
                step: context.step ?? error.step,
                action: context.action ?? error.action,
                resource: context.resource ?? error.resource,
                retryable: context.retryable ?? error.retryable,
                attempt: context.attempt ?? error.attempt,
                details: { ...(error.details || {}), ...(context.details || {}) },
                trace: context.trace ?? error.trace,
                cause: error.cause
            };
            const wrapped = new FlowError(context.message || error.message, {
                code: context.code || error.code,
                ...merged
            });
            if (error.stack) wrapped.stack = error.stack;
            return wrapped;
        }
        return new FlowError(context.message || error?.message || String(error || 'Flow failed.'), {
            code: context.code || error?.code || 'FLOW_STEP_FAILED',
            subsystem: context.subsystem || null,
            operation: context.operation || null,
            step: context.step || null,
            action: context.action || null,
            resource: context.resource || null,
            retryable: context.retryable !== false,
            attempt: context.attempt ?? null,
            details: { ...(error?.details || {}), ...(context.details || {}) },
            trace: context.trace || null,
            cause: error || null
        });
    }

    static fromResult(result, context = {}) {
        if (result?.success !== false) return null;
        const cause = result.error || null;
        return FlowError.wrap(cause || new Error(result.message || 'Operation returned a failed Result.'), {
            code: context.code || cause?.code || result.status || 'FLOW_STEP_FAILED',
            message: context.message || result.message || cause?.message || 'Operation failed.',
            ...context,
            details: { ...(result.meta || {}), ...(context.details || {}) }
        });
    }
}

FlowError.errorDiagnostic = errorDiagnostic;
module.exports = FlowError;
