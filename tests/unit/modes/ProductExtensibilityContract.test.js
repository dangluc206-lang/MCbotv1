'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const WorkflowDefinitionValidator = require('../../../src/modes/composable/WorkflowDefinitionValidator');
const WorkflowDryRunService = require('../../../src/modes/composable/WorkflowDryRunService');
const CustomModePackageService = require('../../../src/modes/composable/CustomModePackageService');
const CustomModeTemplateGallery = require('../../../src/modes/composable/CustomModeTemplateGallery');
const ModeCatalog = require('../../../src/modes/ModeCatalog');
const ModePresentationService = require('../../../src/modes/ModePresentationService');

test('XP-300 every workflow module has a complete fail-closed presentation schema', () => {
    const modules = new WorkflowDefinitionValidator().moduleCatalog();
    assert.equal(modules.length, 17);
    for (const module of modules) {
        assert.equal(module.presentation.contract, 'workflow-module-presentation-v1', module.type);
        assert.match(module.presentation.risk, /^(LOW|MEDIUM|HIGH)$/);
        assert.ok(module.presentation.category);
        assert.ok(Array.isArray(module.presentation.fields));
    }
    const storage = modules.find(item => item.type === 'storage-protect');
    assert.match(storage.presentation.summary, /nung sắt\/vàng/);
    assert.equal(storage.presentation.fixedContract, 'b5-storage-protection-v1');
});

test('XP-300 stale allowSmelting is stripped and cannot weaken storage protection', () => {
    const normalized = new WorkflowDefinitionValidator().normalize({ id:'safe-b5', workflow:{ loop:{ steps:[{ type:'storage-protect', allowSmelting:false }] } } });
    assert.equal(Object.hasOwn(normalized.workflow.loop.steps[0], 'allowSmelting'), false);
});

test('QA upgrade: undeclared module fields never survive normalization', () => {
    const normalized = new WorkflowDefinitionValidator().normalize({ id:'strict-fields', workflow:{ loop:{ steps:[{ type:'wait', ms:10, arbitrary:'secret', constructor:{ polluted:true } }] } } });
    assert.deepEqual(normalized.workflow.loop.steps[0], { type:'wait', ms:10 });
    assert.equal({}.polluted, undefined);
});

test('XP-302 dry-run expands typed control flow but makes zero capability calls', () => {
    const report = new WorkflowDryRunService().simulate({ id:'dry-run-mode', workflow:{ loop:{ steps:[{ type:'if', condition:{ type:'connected' }, then:[{ type:'repeat', count:3, steps:[{ type:'wait', ms:1 }] }], else:[{ type:'home' }] }] } } });
    assert.equal(report.simulatedOnly, true);
    assert.equal(report.capabilityCalls, 0);
    assert.equal(report.expandedSteps, 5);
    assert.equal(report.plan.some(step => step.type === 'home'), false);
    assert.deepEqual(report.unreachedPaths, ['workflow.loop.steps[0].else']);
    assert.equal(report.checks.forbiddenActions, 'PASS');
    assert.equal(report.checks.loopBounds, 'PASS');
    assert.ok(report.estimatedSideEffects >= 0);
});

test('XP-302 dry-run fails closed before unbounded expansion', () => {
    const service = new WorkflowDryRunService({ maxExpandedSteps:10 });
    assert.throws(() => service.simulate({ id:'too-wide', workflow:{ loop:{ steps:[{ type:'repeat', count:20, steps:[{ type:'wait', ms:1 }] }] } } }), error => error.code === 'WORKFLOW_DRY_RUN_LIMIT');
});

test('XP-302 package manifest is deterministic and tamper evident', () => {
    const service = new CustomModePackageService();
    const pkg = service.build({ id:'packaged-mode', workflow:{ loop:{ steps:[{ type:'wait', ms:100 }] } } });
    assert.equal(service.verify(pkg).valid, true);
    const tampered = JSON.parse(JSON.stringify(pkg)); tampered.definition.workflow.loop.steps[0].ms = 200;
    assert.equal(service.verify(tampered).valid, false);
    const dependencyTampered = JSON.parse(JSON.stringify(pkg)); dependencyTampered.manifest.requiredCapabilities.push('raw-client');
    assert.equal(service.verify(dependencyTampered).valid, false);
    const versionTampered = JSON.parse(JSON.stringify(pkg)); versionTampered.manifest.schemaVersion = 2;
    assert.equal(service.verify(versionTampered).valid, false);
});

test('XP-303 template gallery provides safe bounded examples including exact B5 boundary', () => {
    const gallery = new CustomModeTemplateGallery().list();
    assert.ok(gallery.length >= 4);
    const b5 = gallery.find(item => item.id === 'b5-safe-cycle');
    assert.deepEqual(b5.definition.workflow.loop.steps.map(step => step.type), ['read-storage','storage-protect','b5-cycle','wait']);
    assert.equal(JSON.stringify(b5).includes('allowSmelting'), false);
    assert.equal(b5.contract, 'mcbot-custom-mode-template-v1');
    assert.equal(b5.supportStatus, 'BETA');
    assert.deepEqual(b5.serverProfileCompatibility, ['minerua']);
    assert.ok(b5.requiredCapabilities.includes('b1-materials'));
    assert.ok(b5.requestedResources.includes('primary-mode'));
});

test('XP-304 mode presentation accepts a fake future mode without generic branching', () => {
    const catalog = new ModeCatalog([{ id:'future-auction', serviceName:'futureAuction', label:'Future Auction', requiredCapabilities:['gui'], requestedResources:['primary-mode','gui'] }]).seal();
    const [view] = new ModePresentationService({ catalog }).list();
    assert.equal(view.id, 'future-auction');
    assert.equal(view.contract, 'mode-presentation-v1');
    assert.deepEqual(view.requiredCapabilities, ['gui']);
    assert.equal(view.controls.pause, true);
});
