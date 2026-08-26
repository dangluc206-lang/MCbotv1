'use strict';

const { randomUUID } = require('node:crypto');
const Redactor = require('../security/Redactor');

const CONTRACT = 'operator-error-v1';
const SEVERITIES = Object.freeze(['info', 'warning', 'error', 'critical']);
const RETRY_CLASSES = Object.freeze(['NONE', 'IMMEDIATE', 'BACKOFF', 'OPERATOR_GUARDED']);
const CATEGORIES = Object.freeze([
    'CONNECTION', 'COMMAND', 'GUI', 'INVENTORY', 'MOVEMENT', 'CRAFTING',
    'STORAGE', 'SERVER', 'CONFIG', 'TIMEOUT', 'VERIFICATION', 'PERSISTENCE',
    'DESKTOP', 'MODE', 'SECURITY', 'UNKNOWN'
]);

const ACTION_CATALOG = Object.freeze({
    'inspect-diagnostic': Object.freeze({ permission: 'READ', generationGuard: false, idempotencyRequired: false, confirmation: 'NONE' }),
    'export-support': Object.freeze({ permission: 'READ', generationGuard: false, idempotencyRequired: false, confirmation: 'NONE' }),
    'retry-guarded': Object.freeze({ permission: 'PATCH', generationGuard: true, idempotencyRequired: true, confirmation: 'NONE' }),
    'retry-storage-protection': Object.freeze({ permission: 'PATCH', generationGuard: true, idempotencyRequired: true, confirmation: 'NONE' }),
    'reconnect-bot': Object.freeze({ permission: 'PATCH', generationGuard: true, idempotencyRequired: true, confirmation: 'NONE' }),
    'edit-config': Object.freeze({ permission: 'PATCH', generationGuard: false, idempotencyRequired: true, confirmation: 'NONE' }),
    'retry-emergency-stop': Object.freeze({ permission: 'ADMIN', generationGuard: true, idempotencyRequired: true, confirmation: 'DESTRUCTIVE' }),
    'reset-secret-store': Object.freeze({ permission: 'ADMIN', generationGuard: false, idempotencyRequired: true, confirmation: 'DESTRUCTIVE' })
});

const PREFIX_POLICY = Object.freeze({
    CONNECTION: Object.freeze({ severity: 'error', retryClass: 'BACKOFF', safeToRetry: true, actions: ['inspect-diagnostic', 'reconnect-bot', 'export-support'] }),
    COMMAND: Object.freeze({ severity: 'error', retryClass: 'OPERATOR_GUARDED', safeToRetry: false, actions: ['inspect-diagnostic', 'export-support'] }),
    GUI: Object.freeze({ severity: 'error', retryClass: 'OPERATOR_GUARDED', safeToRetry: false, actions: ['inspect-diagnostic', 'export-support'] }),
    INVENTORY: Object.freeze({ severity: 'error', retryClass: 'OPERATOR_GUARDED', safeToRetry: false, actions: ['inspect-diagnostic', 'export-support'] }),
    MOVEMENT: Object.freeze({ severity: 'warning', retryClass: 'BACKOFF', safeToRetry: true, actions: ['inspect-diagnostic', 'retry-guarded'] }),
    CRAFTING: Object.freeze({ severity: 'error', retryClass: 'OPERATOR_GUARDED', safeToRetry: false, actions: ['inspect-diagnostic', 'export-support'] }),
    STORAGE: Object.freeze({ severity: 'error', retryClass: 'OPERATOR_GUARDED', safeToRetry: false, actions: ['inspect-diagnostic', 'retry-storage-protection', 'export-support'] }),
    SERVER: Object.freeze({ severity: 'warning', retryClass: 'BACKOFF', safeToRetry: true, actions: ['inspect-diagnostic', 'retry-guarded'] }),
    CONFIG: Object.freeze({ severity: 'error', retryClass: 'NONE', safeToRetry: false, actions: ['edit-config', 'export-support'] }),
    TIMEOUT: Object.freeze({ severity: 'warning', retryClass: 'BACKOFF', safeToRetry: true, actions: ['inspect-diagnostic', 'retry-guarded'] }),
    VERIFICATION: Object.freeze({ severity: 'error', retryClass: 'OPERATOR_GUARDED', safeToRetry: false, actions: ['inspect-diagnostic', 'export-support'] }),
    PERSISTENCE: Object.freeze({ severity: 'critical', retryClass: 'NONE', safeToRetry: false, actions: ['inspect-diagnostic', 'export-support'] }),
    DESKTOP: Object.freeze({ severity: 'error', retryClass: 'OPERATOR_GUARDED', safeToRetry: false, actions: ['inspect-diagnostic', 'export-support'] }),
    MODE: Object.freeze({ severity: 'error', retryClass: 'BACKOFF', safeToRetry: true, actions: ['inspect-diagnostic', 'retry-guarded', 'export-support'] }),
    SECURITY: Object.freeze({ severity: 'critical', retryClass: 'NONE', safeToRetry: false, actions: ['inspect-diagnostic', 'export-support'] }),
    UNKNOWN: Object.freeze({ severity: 'error', retryClass: 'NONE', safeToRetry: false, actions: ['inspect-diagnostic', 'export-support'] })
});

function normalizeCode(value) {
    const code = String(value || 'UNKNOWN_FAILURE').trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_');
    return code || 'UNKNOWN_FAILURE';
}

function categoryFor(code) {
    const prefix = normalizeCode(code).split('_')[0];
    return CATEGORIES.includes(prefix) ? prefix : 'UNKNOWN';
}

function normalizeActions(actions, fallback) {
    const input = actions == null ? fallback : actions;
    if (!Array.isArray(input)) throw new TypeError('Operator error allowedActions must be an array.');
    const unique = [...new Set(input.map(value => String(value || '').trim()).filter(Boolean))];
    for (const action of unique) {
        if (!ACTION_CATALOG[action]) throw new TypeError(`Unknown operator action: ${action}`);
    }
    return Object.freeze(unique);
}

function create(error, context = {}) {
    const diagnostic = error?.toDiagnostic?.() || error || {};
    const code = normalizeCode(context.code || diagnostic.code);
    const category = context.category || categoryFor(code);
    if (!CATEGORIES.includes(category)) throw new TypeError(`Unknown error category: ${category}`);
    const policy = PREFIX_POLICY[category];
    const severity = context.severity || policy.severity;
    const retryClass = context.retryClass || policy.retryClass;
    if (!SEVERITIES.includes(severity)) throw new TypeError(`Unknown error severity: ${severity}`);
    if (!RETRY_CLASSES.includes(retryClass)) throw new TypeError(`Unknown retry class: ${retryClass}`);
    const safeToRetry = context.safeToRetry ?? policy.safeToRetry;
    const allowedActions = normalizeActions(context.allowedActions, policy.actions);
    const correlationId = String(context.correlationId || diagnostic.correlationId || randomUUID());
    const operatorSummary = String(context.operatorSummary || context.message || diagnostic.message || 'Đã xảy ra lỗi chưa xác định.').slice(0, 500);
    const technicalSummary = String(context.technicalSummary || diagnostic.message || context.message || operatorSummary).slice(0, 2000);
    return Object.freeze(Redactor.sanitize({
        contract: CONTRACT,
        code,
        category,
        severity,
        retryClass,
        safeToRetry: Boolean(safeToRetry),
        operatorState: context.operatorState || (severity === 'critical' ? 'ACTION_REQUIRED' : safeToRetry ? 'RECOVERING' : 'BLOCKED'),
        operatorSummary,
        technicalSummary,
        allowedActions,
        correlationId,
        incidentId: context.incidentId == null ? null : String(context.incidentId),
        occurredAt: context.occurredAt || new Date().toISOString(),
        details: context.details ?? diagnostic.details ?? null
    }));
}

function validate(value) {
    const errors = [];
    if (!value || value.contract !== CONTRACT) errors.push('contract');
    if (!value || !/^[A-Z][A-Z0-9_]*$/.test(String(value.code || ''))) errors.push('code');
    if (!CATEGORIES.includes(value?.category)) errors.push('category');
    if (!SEVERITIES.includes(value?.severity)) errors.push('severity');
    if (!RETRY_CLASSES.includes(value?.retryClass)) errors.push('retryClass');
    if (typeof value?.safeToRetry !== 'boolean') errors.push('safeToRetry');
    if (!value?.correlationId) errors.push('correlationId');
    if (!Array.isArray(value?.allowedActions) || value.allowedActions.some(action => !ACTION_CATALOG[action])) errors.push('allowedActions');
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

module.exports = Object.freeze({
    CONTRACT,
    SEVERITIES,
    RETRY_CLASSES,
    CATEGORIES,
    ACTION_CATALOG,
    PREFIX_POLICY,
    categoryFor,
    create,
    validate
});
