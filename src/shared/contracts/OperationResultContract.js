'use strict';

const Status = require('../result/Status');
const Redactor = require('../security/Redactor');
const ErrorContract = require('./ErrorContract');

const CONTRACT = 'operation-result-v1';
const Outcome = Object.freeze({
    SUCCESS: 'SUCCESS',
    FAILED: 'FAILED',
    UNCERTAIN: 'UNCERTAIN',
    STALE: 'STALE',
    CANCELLED: 'CANCELLED'
});

const STALE_CODE = /(?:^|_)STALE(?:_|$)|STALE_GENERATION/i;
const UNCERTAIN_CODE = /(?:^|_)UNCERTAIN(?:_|$)|OUTCOME_UNCERTAIN/i;

function text(value) {
    const normalized = String(value ?? '').trim();
    return normalized || null;
}

function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

function machineCode(value) {
    return text(value)?.toUpperCase() || null;
}

function classify({ status = null, code = null, success = false } = {}) {
    const normalizedCode = machineCode(code);
    if (status === Status.CANCELLED || normalizedCode === 'CANCELLED') return Outcome.CANCELLED;
    if (STALE_CODE.test(normalizedCode || '') || status === 'STALE') return Outcome.STALE;
    if (UNCERTAIN_CODE.test(normalizedCode || '') || status === 'UNCERTAIN') return Outcome.UNCERTAIN;
    if (success === true || status === Status.SUCCESS) return Outcome.SUCCESS;
    return Outcome.FAILED;
}

function errorDiagnostic(error) {
    return error ? ErrorContract.create(error) : null;
}

function create(input = {}) {
    const code = machineCode(input.code || input.error?.code || input.meta?.code || input.data?.code || input.status);
    const status = text(input.status) || (input.success === true ? Status.SUCCESS : Status.FAILED);
    const generation = positiveInteger(input.connectionGeneration ?? input.generation);
    if ((input.connectionGeneration ?? input.generation) != null && generation === null) {
        throw new TypeError('Operation result connectionGeneration must be a positive integer');
    }
    const outcome = input.outcome || classify({ status, code, success: input.success === true });
    if (!Object.values(Outcome).includes(outcome)) throw new TypeError(`Unsupported operation outcome: ${String(outcome)}`);

    return Object.freeze({
        contract: CONTRACT,
        outcome,
        status,
        success: outcome === Outcome.SUCCESS,
        code,
        botId: text(input.botId),
        connectionGeneration: generation,
        operationId: text(input.operationId),
        correlationId: text(input.correlationId),
        data: Redactor.sanitize(input.data ?? null),
        meta: Redactor.sanitize(input.meta ?? null),
        error: errorDiagnostic(input.error),
        // Message remains operator-facing only. Consumers must branch on outcome/code.
        message: input.message == null ? '' : Redactor.redactText(String(input.message))
    });
}

function fromLegacy(result, context = {}) {
    if (!result || typeof result !== 'object') throw new TypeError('Legacy result object is required');
    return create({
        status: result.status,
        success: result.success,
        data: result.data,
        error: result.error,
        message: result.message,
        meta: result.meta,
        code: context.code,
        botId: context.botId,
        connectionGeneration: context.connectionGeneration,
        operationId: context.operationId,
        correlationId: context.correlationId
    });
}

function canApplyToGeneration(result, { botId, connectionGeneration } = {}) {
    if (!result || typeof result !== 'object') return false;
    const expectedGeneration = positiveInteger(connectionGeneration);
    if (expectedGeneration === null) return false;
    if (result.connectionGeneration !== expectedGeneration) return false;
    const expectedBotId = text(botId);
    if (expectedBotId && result.botId && result.botId !== expectedBotId) return false;
    return result.outcome !== Outcome.STALE && result.outcome !== Outcome.CANCELLED;
}

function is(value) {
    return Boolean(value
        && value.contract === CONTRACT
        && Object.values(Outcome).includes(value.outcome)
        && typeof value.success === 'boolean'
        && typeof value.status === 'string');
}

module.exports = Object.freeze({ CONTRACT, Outcome, create, fromLegacy, classify, canApplyToGeneration, is });
