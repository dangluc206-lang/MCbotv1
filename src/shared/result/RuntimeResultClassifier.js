'use strict';

const Status = require('./Status');
const OperationResultContract = require('../contracts/OperationResultContract');

const WAIT_STATUSES = new Set([Status.NOT_READY, Status.NOT_ENOUGH_MATERIALS]);
const WAIT_CODES = new Set(['NOT_READY', 'WAITING_MATERIALS', 'NOT_ENOUGH_MATERIALS']);

function normalizeCode(value) {
    const text = String(value || '').trim();
    return text ? text.toUpperCase() : null;
}

function classifyRuntimeResult({ result = null, error = null, token = null } = {}) {
    if (token?.isCancelled === true) {
        return Object.freeze({
            kind: 'TOKEN_CANCELLED',
            status: result?.status || null,
            code: normalizeCode(error?.code || result?.error?.code),
            error: error || result?.error || null
        });
    }

    const effectiveError = error || result?.error || null;
    const status = result?.status || null;
    const code = normalizeCode(
        effectiveError?.code
        || result?.meta?.code
        || result?.data?.code
        || result?.code
    );

    const outcome = OperationResultContract.classify({ status, code, success: result?.success === true });

    if (outcome === OperationResultContract.Outcome.CANCELLED
        || effectiveError?.name === 'OperationCancelledError') {
        return Object.freeze({ kind: 'EXPECTED_CANCEL', status, code: code || 'CANCELLED', error: effectiveError });
    }

    if (outcome === OperationResultContract.Outcome.STALE) {
        return Object.freeze({ kind: 'STALE', status, code: code || 'STALE', error: effectiveError });
    }

    if (WAIT_STATUSES.has(status)
        || WAIT_CODES.has(code)
        || result?.data?.waitingForMaterials === true
        || result?.meta?.waitingForMaterials === true
        || result?.waitingForMaterials === true) {
        return Object.freeze({ kind: 'WAIT', status, code: code || status, error: effectiveError });
    }

    return Object.freeze({ kind: 'FAILURE', status, code, error: effectiveError });
}

module.exports = Object.freeze({ classifyRuntimeResult, WAIT_STATUSES, WAIT_CODES });