'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ModuleRegistry = require('../../../src/modes/composable/ModuleRegistry');
const WorkflowDefinitionValidator = require('../../../src/modes/composable/WorkflowDefinitionValidator');
const WorkflowSchemaMigrator = require('../../../src/modes/composable/WorkflowSchemaMigrator');
const WorkflowResourceBudget = require('../../../src/modes/composable/WorkflowResourceBudget');
const WorkflowStepExecutor = require('../../../src/modes/composable/WorkflowStepExecutor');

test('ModuleRegistry rejects duplicate descriptors and executor resource drift', () => {
    const registry = new ModuleRegistry();
    const descriptor = { type: 'custom-step', capability: null, transientResources: ['custom'], executor: { execute() {}, resources: ['other'] } };
    assert.throws(() => registry.register(descriptor), error => error.code === 'WORKFLOW_MODULE_RESOURCE_MISMATCH');
    registry.register({ ...descriptor, executor: { execute() {}, resources: ['custom'] } });
    assert.throws(() => registry.register({ ...descriptor, executor: { execute() {}, resources: ['custom'] } }), error => error.code === 'WORKFLOW_MODULE_DUPLICATE');
});

test('workflow migration is deterministic and validator rejects incompatible profiles', () => {
    const migrator = new WorkflowSchemaMigrator();
    const legacy = { id: 'legacy', workflow: { loop: { intervalMs: 100, steps: [] } } };
    assert.deepEqual(migrator.migrate(legacy), migrator.migrate(JSON.parse(JSON.stringify(legacy))));
    const validator = new WorkflowDefinitionValidator({ serverProfile: 'generic' });
    assert.throws(() => validator.normalize({ id: 'minerua-only', serverProfiles: ['minerua'], workflow: { loop: { steps: [{ type: 'b5-cycle' }] } } }), error => error.code === 'WORKFLOW_SERVER_PROFILE_MISMATCH' || error.code === 'WORKFLOW_MODULE_SERVER_PROFILE_MISMATCH');
});

test('runtime resource budget is enforced by WorkflowStepExecutor', async () => {
    const modeContext = {
        generation: () => 1,
        connected: () => true,
        capability: () => ({})
    };
    const executor = new WorkflowStepExecutor({ modeId: 'budgeted', modeContext });
    await assert.rejects(
        executor.executeSteps([{ type: 'wait', ms: 1 }, { type: 'wait', ms: 1 }], {
            budget: new WorkflowResourceBudget({ maxSteps: 1 })
        }),
        error => error.code === 'WORKFLOW_RESOURCE_BUDGET_STEPS'
    );
});
