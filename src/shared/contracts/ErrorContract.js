'use strict';

const Redactor = require('../security/Redactor');

const CONTRACT = 'stable-error-v1';

function create(error, context = {}) {
    if (!error && !context.code) throw new TypeError('Error or stable code is required');
    const diagnostic = error?.toDiagnostic?.() || {
        name: error?.name || 'Error',
        code: error?.code || context.code || 'FAILED',
        message: error?.message || context.message || 'Operation failed.',
        details: error?.details ?? null
    };
    return Object.freeze(Redactor.sanitize({
        contract: CONTRACT,
        name: diagnostic.name || 'Error',
        code: String(context.code || diagnostic.code || 'FAILED').toUpperCase(),
        message: context.message || diagnostic.message || '',
        retryable: context.retryable ?? diagnostic.retryable ?? null,
        details: context.details ?? diagnostic.details ?? null,
        causeCode: error?.cause?.code || diagnostic.cause?.code || null
    }));
}

function is(value) {
    return Boolean(value && value.contract === CONTRACT && typeof value.code === 'string' && value.code.length > 0);
}

module.exports = Object.freeze({ CONTRACT, create, is });
