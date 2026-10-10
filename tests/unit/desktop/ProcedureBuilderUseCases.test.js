'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const ProcedureBuilderUseCases = require(path.join(ROOT, 'src/desktop/use-cases/ProcedureBuilderUseCases'));
const ProcedureStepCatalog = require(path.join(ROOT, 'src/server-features/crafting/procedure/ProcedureStepCatalog'));
const ProcedureRegistry = require(path.join(ROOT, 'src/server-features/crafting/procedure/ProcedureRegistry'));
const PROCEDURES = require(path.join(ROOT, 'config/server-data/procedures.json'));

function draftOf(id, steps) {
    return { id, label: `Label ${id}`, description: '', quantityStrategy: 'button-batch', maxBatch: 64, steps };
}

test('G20 catalog exposes exactly the runtime step schema in both directions', () => {
    const catalog = new ProcedureBuilderUseCases().catalog();
    assert.deepEqual(catalog.map(entry => entry.type), [...ProcedureRegistry.STEP_TYPES]);
    for (const entry of catalog) {
        assert.match(entry.presentation.contract, /^procedure-step-presentation-v1$/);
        assert.ok(['runtime', 'operation'].includes(entry.owner), entry.type);
    }
    assert.throws(() => ProcedureStepCatalog.require('invented-step'), { code: 'PROCEDURE_STEP_CATALOG_MISSING' });
});

test('G20 builder validates required parameters and rejects unsupported step types', () => {
    const useCases = new ProcedureBuilderUseCases();

    assert.equal(useCases.validate(null).valid, false);
    assert.equal(useCases.validate(draftOf('', [{ type: 'click' }])).valid, false);
    const noSteps = useCases.validate(draftOf('p', []));
    assert.equal(noSteps.valid, false);
    assert.match(noSteps.errors.join(' '), /ít nhất một step/);

    const unknown = useCases.validate(draftOf('p', [{ type: 'teleport', x: 1 }]));
    assert.equal(unknown.valid, false);
    assert.match(unknown.errors.join(' '), /step 0/);

    const missingParam = useCases.validate(draftOf('p', [{ type: 'open-gui', guiId: '   ' }]));
    assert.equal(missingParam.valid, false);
    assert.match(missingParam.errors.join(' '), /guiId/);

    const badPattern = useCases.validate(draftOf('p', [{ type: 'slash-command', command: 'is' }]));
    assert.equal(badPattern.valid, false);
    assert.match(badPattern.errors.join(' '), /pattern/);

    const valid = useCases.validate(draftOf('p', [
        { type: 'command', commandKey: 'minerals' },
        { type: 'find-logical-item', itemId: '$recipe.output' },
        { type: 'click' },
        { type: 'verify-quantity', amount: '$execution.remaining' }
    ]));
    assert.equal(valid.valid, true);
    assert.equal(valid.normalized.id, 'p');
    assert.equal(valid.normalized.steps.length, 4);
});

test('G20 every shipped procedure passes the builder validator without drift', () => {
    const useCases = new ProcedureBuilderUseCases();
    for (const [id, definition] of Object.entries(PROCEDURES)) {
        const validation = useCases.validate({ id, ...definition });
        assert.equal(validation.valid, true, `${id}: ${validation.errors?.join(' · ')}`);
        assert.deepEqual(
            validation.normalized.steps.map(step => step.type),
            definition.steps.map(step => step.type),
            `${id}: step order must survive validation`
        );
    }
});

test('G20 dry-run is pure: zero capability calls, quantity plan comes from the runtime strategy', () => {
    const useCases = new ProcedureBuilderUseCases();
    const report = useCases.dryRun(draftOf('sim', [
        { type: 'command', commandKey: 'minerals' },
        { type: 'wait-for-output', timeoutMs: 5000 }
    ]), { requested: 137, outputAmount: 1 });

    assert.equal(report.contract, 'procedure-dry-run-v1');
    assert.equal(report.simulatedOnly, true);
    assert.equal(report.capabilityCalls, 0);
    assert.equal(report.requested, 137);
    assert.deepEqual(report.batches.map(batch => batch.batchAmount), [64, 64, ...Array(9).fill(1)]);
    assert.equal(report.batches.length, 11);
    assert.equal(report.batches.reduce((sum, batch) => sum + batch.expectedOutput, 0), 137);
    assert.equal(report.ownerCounts.runtime, 1);
    assert.equal(report.ownerCounts.operation, 1);
    assert.deepEqual(report.checks, { stepCatalog: 'PASS', requiredParams: 'PASS', registryNormalize: 'PASS', quantityPlan: 'PASS' });
    assert.ok(Object.isFrozen(report));
});

test('G20 dry-run fails closed on an invalid draft or an impossible request', () => {
    const useCases = new ProcedureBuilderUseCases();
    assert.throws(() => useCases.dryRun(draftOf('sim', [])), { code: 'PROCEDURE_INVALID' });
    assert.throws(() => useCases.dryRun(draftOf('sim', [{ type: 'click' }]), { requested: 0 }), { code: 'PROCEDURE_INVALID' });
    assert.throws(() => useCases.dryRun(draftOf('sim', [{ type: 'click' }]), { requested: 1.5 }), { code: 'PROCEDURE_INVALID' });
});

test('G20 command-quantity procedures plan a single full-amount batch', () => {
    const useCases = new ProcedureBuilderUseCases();
    const report = useCases.dryRun({
        id: 'single-shot', quantityStrategy: 'command-quantity', maxBatch: 1,
        steps: [{ type: 'slash-command', command: '/ks craft 137' }]
    }, { requested: 137, outputAmount: 1 });
    assert.equal(report.batches.length, 1);
    assert.equal(report.batches[0].action, 'command-quantity');
    assert.equal(report.batches[0].expectedOutput, 137);
});
