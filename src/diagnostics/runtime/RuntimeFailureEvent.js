'use strict';

const { randomUUID } = require('node:crypto');
const FlowError = require('../../shared/errors/FlowError');
const Redactor = require('../../shared/security/Redactor');

function text(value) {
    return value === undefined || value === null || value === '' ? null : String(value);
}

function diagnosticFrom(input = {}) {
    if (input.diagnostic && typeof input.diagnostic === 'object') return Redactor.sanitize(input.diagnostic);
    if (input.error?.toDiagnostic) return Redactor.sanitize(input.error.toDiagnostic());
    if (input.error) return Redactor.sanitize(FlowError.errorDiagnostic(input.error));
    return {};
}

function createFailureEvent(input = {}, { botId = null, failureId = null, now = Date.now() } = {}) {
    const diagnostic = diagnosticFrom(input) || {};
    const rawMessage = input.message || diagnostic.message || input.error?.message || input.reason || 'Runtime failure.';
    const occurredAt = input.occurredAt || new Date(now).toISOString();
    return Object.freeze({
        failureId: text(input.failureId || failureId || randomUUID()),
        botId: text(input.botId || botId),
        connectionGeneration: Number.isInteger(input.connectionGeneration) ? input.connectionGeneration : null,
        source: text(input.source || diagnostic.source || diagnostic.subsystem || 'runtime'),
        subsystem: text(input.subsystem || diagnostic.subsystem || input.source || 'runtime'),
        severity: text(input.severity || 'error'),
        code: text(input.code || diagnostic.code || input.error?.code || 'RUNTIME_FAILURE'),
        operation: text(input.operation || diagnostic.operation),
        step: text(input.step || diagnostic.step),
        action: text(input.action || diagnostic.action),
        resource: text(input.resource || diagnostic.resource),
        message: Redactor.redactText(rawMessage),
        retryable: input.retryable !== undefined ? input.retryable !== false : diagnostic.retryable !== false,
        correlationId: text(input.correlationId || input.operationId || diagnostic.correlationId || diagnostic.operationId),
        operationId: text(input.operationId || diagnostic.operationId),
        occurredAt,
        phase: text(input.phase),
        retryInMs: Number.isFinite(Number(input.retryInMs)) ? Number(input.retryInMs) : null,
        diagnostic: Redactor.sanitize({
            ...diagnostic,
            stack: input.stack || input.error?.stack || diagnostic.stack || null
        }),
        details: Redactor.sanitize(input.details ?? diagnostic.details ?? null)
    });
}

function signature(event = {}) {
    return [
        event.botId || '',
        Number.isInteger(event.connectionGeneration) ? event.connectionGeneration : '',
        event.code || '',
        event.operation || '',
        event.step || '',
        event.resource || '',
        event.message || ''
    ].join('|');
}

module.exports = Object.freeze({ createFailureEvent, signature });