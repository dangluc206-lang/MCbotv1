'use strict';

function plainError(error) {
    if (!error) return null;
    return Object.freeze({
        name: error.name || 'Error',
        code: error.code || null,
        message: error.message || String(error)
    });
}

function resultPayload(result) {
    if (!result || typeof result !== 'object') return result;
    return Object.freeze({
        success: result.success !== false,
        status: result.status || null,
        message: result.message || null,
        data: result.data ?? null,
        error: plainError(result.error)
    });
}

module.exports = Object.freeze({ plainError, resultPayload });

