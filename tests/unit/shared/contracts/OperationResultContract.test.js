'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Result = require('../../../../src/shared/result/Result');
const FlowError = require('../../../../src/shared/errors/FlowError');
const Contract = require('../../../../src/shared/contracts/OperationResultContract');
const { classifyRuntimeResult } = require('../../../../src/shared/result/RuntimeResultClassifier');
const ErrorContract = require('../../../../src/shared/contracts/ErrorContract');
const { createEventEnvelope } = require('../../../../src/core/events/EventEnvelope');

const { Outcome } = Contract;

test('operation result facade preserves legacy public fields and classifies stable outcomes', () => {
    const legacy = Result.ok({ value: 3 }, { source: 'test' });
    const result = Contract.fromLegacy(legacy, { botId: 'bot-1', connectionGeneration: 4, operationId: 'op-1' });
    assert.equal(result.contract, 'operation-result-v1');
    assert.equal(result.status, legacy.status);
    assert.equal(result.success, legacy.success);
    assert.deepEqual(result.data, legacy.data);
    assert.equal(result.outcome, Outcome.SUCCESS);

    assert.equal(Contract.create({ status: 'FAILED', code: 'CRAFTING_OUTCOME_UNCERTAIN' }).outcome, Outcome.UNCERTAIN);
    assert.equal(Contract.create({ status: 'FAILED', code: 'GUI_STALE_GENERATION' }).outcome, Outcome.STALE);
    assert.equal(Contract.create({ status: 'CANCELLED', code: 'CANCELLED' }).outcome, Outcome.CANCELLED);
});

test('machine decisions use code/outcome, never operator message text', () => {
    const result = Contract.create({ status: 'FAILED', code: 'CRAFTING_OUTCOME_UNCERTAIN', message: 'success maybe?' });
    assert.equal(result.outcome, Outcome.UNCERTAIN);
    const differentMessage = Contract.create({ status: 'FAILED', code: 'CRAFTING_OUTCOME_UNCERTAIN', message: 'totally different text' });
    assert.equal(differentMessage.outcome, result.outcome);
});

test('error/result serialization redacts sensitive values and preserves leaf cause code', () => {
    const cause = Object.assign(new Error('token=super-secret'), { code: 'LEAF_TIMEOUT' });
    const error = new FlowError('password=hunter2', { code: 'OUTER_FAILED', cause, details: { authorization: 'Bearer abc' } });
    const stable = ErrorContract.create(error);
    const serialized = JSON.stringify(stable);
    assert.equal(stable.code, 'OUTER_FAILED');
    assert.equal(stable.causeCode, 'LEAF_TIMEOUT');
    assert.doesNotMatch(serialized, /hunter2|super-secret|Bearer abc/);
});

test('connection event and stale result application enforce bot/generation identity', () => {
    assert.throws(() => createEventEnvelope('connection:ready', { botId: 'bot-1' }, { scope: 'connection' }), /connectionGeneration/);
    const event = createEventEnvelope('connection:ready', { botId: 'bot-1', connectionGeneration: 7, client: { raw: true } }, { scope: 'connection', clock: () => 1, idFactory: () => 'e1' });
    assert.equal(event.botId, 'bot-1');
    assert.equal(event.connectionGeneration, 7);
    assert.equal('client' in event, false);

    const current = Contract.create({ status: 'SUCCESS', success: true, botId: 'bot-1', connectionGeneration: 7 });
    assert.equal(Contract.canApplyToGeneration(current, { botId: 'bot-1', connectionGeneration: 7 }), true);
    assert.equal(Contract.canApplyToGeneration(current, { botId: 'bot-1', connectionGeneration: 8 }), false);
    const stale = Contract.create({ status: 'FAILED', code: 'COMMAND_STALE_GENERATION', botId: 'bot-1', connectionGeneration: 7 });
    assert.equal(Contract.canApplyToGeneration(stale, { botId: 'bot-1', connectionGeneration: 7 }), false);
});


test('runtime classifier exposes STALE as a non-business-failure boundary', () => {
    const error = Object.assign(new Error('generation replaced'), { code: 'COLLECTOR_STALE_GENERATION' });
    const classified = classifyRuntimeResult({ error });
    assert.equal(classified.kind, 'STALE');
    assert.equal(classified.code, 'COLLECTOR_STALE_GENERATION');
});
