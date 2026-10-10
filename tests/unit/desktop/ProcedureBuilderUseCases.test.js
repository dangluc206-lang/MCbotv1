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

test('G20.2 wait-for-message validates the nested params.pattern contract', () => {
    const useCases = new ProcedureBuilderUseCases();
    const message = params => draftOf('p', [{ type: 'wait-for-message', ...(params === undefined ? {} : { params }) }]);

    const valid = useCases.validate(message({ pattern: 'hello' }));
    assert.equal(valid.valid, true);
    assert.deepEqual(valid.normalized.steps[0], { type: 'wait-for-message', params: { pattern: 'hello' } });

    assert.equal(useCases.validate(message(undefined)).valid, false);
    assert.equal(useCases.validate(message({})).valid, false);
    assert.equal(useCases.validate(message({ pattern: '   ' })).valid, false);
    assert.equal(useCases.validate(message({ pattern: 42 })).valid, false);
    assert.equal(useCases.validate(message({ pattern: null })).valid, false);
    assert.equal(useCases.validate(message({ pattern: 'x', bogus: 1 })).valid, false);
    assert.equal(useCases.validate(message(['x'])).valid, false);
    assert.equal(useCases.validate(message('x')).valid, false);
    // A top-level `pattern` is NOT the declared nested key — it would be dropped.
    assert.equal(useCases.validate(draftOf('p', [{ type: 'wait-for-message', pattern: 'x' }])).valid, false);

    // Normalized shape round-trips through the Registry without data loss.
    const reread = new ProcedureRegistry({ [valid.normalized.id]: valid.normalized }).require(valid.normalized.id);
    assert.deepEqual(reread.steps[0], { type: 'wait-for-message', params: { pattern: 'hello' } });
});

test('G20.2 integer strings tolerate surrounding whitespace, nothing else', () => {
    const useCases = new ProcedureBuilderUseCases();
    const timeout = timeoutMs => draftOf('p', [{ type: 'command', commandKey: 'minerals', timeoutMs }]);

    const padded = useCases.validate(timeout(' 5000 '));
    assert.equal(padded.valid, true);
    assert.equal(padded.normalized.steps[0].timeoutMs, 5000);

    for (const bad of ['5.0', '0x10', '5e2', '', '  ']) {
        assert.equal(useCases.validate(timeout(bad)).valid, false, `${JSON.stringify(bad)} must be rejected`);
    }
});

test('G20.1 optional integer fields validate type and bounds when provided', () => {
    const useCases = new ProcedureBuilderUseCases();
    const timeout = timeoutMs => draftOf('p', [{ type: 'command', commandKey: 'minerals', ...(timeoutMs === undefined ? {} : { timeoutMs }) }]);

    assert.equal(useCases.validate(timeout(undefined)).valid, true);
    assert.equal(useCases.validate(timeout(100)).valid, true);
    assert.equal(useCases.validate(timeout(30000)).valid, true);
    // Canonical integer strings normalize explicitly (advanced-JSON path).
    const asString = useCases.validate(timeout('5000'));
    assert.equal(asString.valid, true);
    assert.equal(asString.normalized.steps[0].timeoutMs, 5000);

    for (const bad of [99, 30001, 1.5, NaN, Infinity, 'abc', '5.0', '0x10', '5e2', '', '  ', true, false, {}, []]) {
        const result = useCases.validate(timeout(bad));
        assert.equal(result.valid, false, `timeoutMs=${JSON.stringify(String(bad))} must be rejected`);
        assert.match(result.errors.join(' '), /timeoutMs/);
    }
    // min/max are inclusive on both ends.
    const lo = useCases.validate(draftOf('p', [{ type: 'wait-for-gui', guiId: 'crafting', timeoutMs: 100 }]));
    assert.equal(lo.valid, true);
    const hi = useCases.validate(draftOf('p', [{ type: 'wait-for-gui', guiId: 'crafting', timeoutMs: 30000 }]));
    assert.equal(hi.valid, true);
});

test('G20.1 wait.ms and verify-item.amount bounds are enforced', () => {
    const useCases = new ProcedureBuilderUseCases();

    assert.equal(useCases.validate(draftOf('p', [{ type: 'wait', ms: 0 }])).valid, true);
    assert.equal(useCases.validate(draftOf('p', [{ type: 'wait', ms: 3600000 }])).valid, true);
    assert.equal(useCases.validate(draftOf('p', [{ type: 'wait', ms: -1 }])).valid, false);
    assert.equal(useCases.validate(draftOf('p', [{ type: 'wait', ms: 3600001 }])).valid, false);
    assert.equal(useCases.validate(draftOf('p', [{ type: 'wait', ms: 0.5 }])).valid, false);

    // verify-item.amount is optional per the catalog: absent is fine, provided is checked.
    assert.equal(useCases.validate(draftOf('p', [{ type: 'verify-item' }])).valid, true);
    assert.equal(useCases.validate(draftOf('p', [{ type: 'verify-item', amount: 1 }])).valid, true);
    assert.equal(useCases.validate(draftOf('p', [{ type: 'verify-item', amount: 0 }])).valid, false);
    assert.equal(useCases.validate(draftOf('p', [{ type: 'verify-item', amount: 2.5 }])).valid, false);
});

test('G20.1 required, text-type and pattern rules hold for optional fields too', () => {
    const useCases = new ProcedureBuilderUseCases();

    assert.equal(useCases.validate(draftOf('p', [{ type: 'open-gui', guiId: '   ' }])).valid, false);
    assert.equal(useCases.validate(draftOf('p', [{ type: 'open-gui' }])).valid, false);
    assert.equal(useCases.validate(draftOf('p', [{ type: 'open-gui', guiId: null }])).valid, false);
    assert.equal(useCases.validate(draftOf('p', [{ type: 'slash-command', command: 'is' }])).valid, false);
    assert.equal(useCases.validate(draftOf('p', [{ type: 'slash-command', command: '/is' }])).valid, true);
    // Non-string into a text field is rejected, never coerced.
    assert.equal(useCases.validate(draftOf('p', [{ type: 'command', commandKey: 42 }])).valid, false);
    assert.equal(useCases.validate(draftOf('p', [{ type: 'command', commandKey: { id: 'minerals' } }])).valid, false);
});

test('G20.1 empty optional text is dropped as not-provided; malformed values are not', () => {
    const useCases = new ProcedureBuilderUseCases();

    const dropped = useCases.validate(draftOf('p', [{ type: 'verify-item', itemId: '   ' }]));
    assert.equal(dropped.valid, true);
    assert.deepEqual(dropped.normalized.steps[0], { type: 'verify-item' });

    assert.equal(useCases.validate(draftOf('p', [{ type: 'command', commandKey: 'minerals', timeoutMs: '' }])).valid, false);
    assert.equal(useCases.validate(draftOf('p', [{ type: 'command', commandKey: 'minerals', timeoutMs: 'abc' }])).valid, false);
});

test('G20.1 unknown fields are rejected so Registry drops cannot lose data', () => {
    const useCases = new ProcedureBuilderUseCases();
    const result = useCases.validate(draftOf('p', [{ type: 'command', commandKey: 'minerals', bogusField: 'x' }]));
    assert.equal(result.valid, false);
    assert.match(result.errors.join(' '), /không được hỗ trợ/);
});

test('G20.1 validation normalizes canonical values the Registry accepts unchanged', () => {
    const useCases = new ProcedureBuilderUseCases();
    const result = useCases.validate(draftOf('p', [
        { type: 'command', commandKey: 'minerals', timeoutMs: '5000' },
        { type: 'find-logical-item', itemId: '$recipe.output' }
    ]));
    assert.equal(result.valid, true);
    // The validator already stored a number; nothing is lost through the Registry.
    assert.equal(result.normalized.steps[0].timeoutMs, 5000);
    const reread = new ProcedureRegistry({ [result.normalized.id]: result.normalized }).require(result.normalized.id);
    assert.deepEqual(reread.steps, result.normalized.steps);
});