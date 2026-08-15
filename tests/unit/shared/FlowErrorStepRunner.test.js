'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const FlowError = require('../../../src/shared/errors/FlowError');
const StepRunner = require('../../../src/shared/flow/StepRunner');

test('StepRunner records failed retry and preserves structured flow context', async () => {
    const trace = [];
    const runner = new StepRunner({ operation: 'DemoOperation', trace });
    let calls = 0;
    const value = await runner.run({
        subsystem: 'demo',
        step: 'read-state',
        action: 'read server state',
        resource: '/demo'
    }, async () => {
        calls += 1;
        if (calls === 1) throw new Error('temporary');
        return 42;
    }, { retries: 1 });

    assert.equal(value, 42);
    assert.equal(calls, 2);
    assert.equal(trace.length, 2);
    assert.equal(trace[0].status, 'failed');
    assert.equal(trace[1].status, 'ok');
});

test('FlowError diagnostic carries step/action/resource/details and cause', () => {
    const error = FlowError.wrap(new Error('boom'), {
        code: 'DEMO_FAILED',
        subsystem: 'demo',
        operation: 'DemoOperation',
        step: 'verify',
        action: 'verify output',
        resource: 'custom_item',
        details: { before: 1, after: 1 }
    });
    const diagnostic = error.toDiagnostic();
    assert.equal(diagnostic.code, 'DEMO_FAILED');
    assert.equal(diagnostic.step, 'verify');
    assert.equal(diagnostic.action, 'verify output');
    assert.equal(diagnostic.resource, 'custom_item');
    assert.deepEqual(diagnostic.details, { before: 1, after: 1 });
    assert.equal(diagnostic.cause.message, 'boom');
});

test('StepRunner preserves nested leaf FlowError and appends parent context', async () => {
    const trace = [];
    const runner = new StepRunner({ operation: 'B5AutomationNext', trace });

    await assert.rejects(
        runner.run({
            subsystem: 'b5',
            step: 'reserve-b3-chain',
            action: 'craft B2/B3 reserve chain',
            resource: 'diamond',
            details: { b2Id: 'refined_diamond', b3Id: 'refined_diamond_block' }
        }, async () => {
            throw new FlowError('Crafting produced no verified inventory output for refined_diamond_block.', {
                code: 'CRAFTING_OUTPUT_NOT_VERIFIED',
                subsystem: 'crafting',
                operation: 'CraftingOperation',
                step: 'verify-output',
                action: 'verify quantity 64',
                resource: 'refined_diamond_block',
                attempt: 10,
                details: { recipeId: 'refined_diamond_block', amount: 64, before: 1, after: 1 }
            });
        }),
        error => {
            assert.equal(error.code, 'CRAFTING_OUTPUT_NOT_VERIFIED');
            assert.equal(error.operation, 'CraftingOperation');
            assert.equal(error.step, 'verify-output');
            assert.equal(error.action, 'verify quantity 64');
            assert.equal(error.resource, 'refined_diamond_block');
            assert.equal(error.attempt, 10);
            assert.equal(error.details.recipeId, 'refined_diamond_block');
            assert.equal(error.details.parentFlow.length, 1);
            assert.equal(error.details.parentFlow[0].operation, 'B5AutomationNext');
            assert.equal(error.details.parentFlow[0].step, 'reserve-b3-chain');
            assert.equal(error.details.parentFlow[0].resource, 'diamond');
            return true;
        }
    );
});
