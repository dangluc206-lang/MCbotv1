'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const html = fs.readFileSync(path.join(root, 'src/desktop/renderer/index.html'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src/desktop/preload.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/desktop/renderer/app.js'), 'utf8');
const bindings = fs.readFileSync(path.join(root, 'src/desktop/renderer/core/RendererEventBindings.js'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'src/desktop/DesktopController.js'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'architecture/catalog.json'), 'utf8'));

const BINDINGS_MODULE = 'src/desktop/renderer/features/procedure/ProcedureBuilderBindings.js';

test('G20 procedure builder is wired end to end through the existing boundaries', () => {
    // Renderer loads its own feature boundary before app.js (XP-200) and the
    // event facade delegates instead of owning procedure logic.
    assert.match(html, new RegExp(`features/procedure/ProcedureBuilderBindings\\.js`));
    assert.ok(html.indexOf('features/procedure/ProcedureBuilderBindings.js') < html.indexOf('src="app.js"'));
    assert.ok(catalog.runtimeEntrypoints.includes(BINDINGS_MODULE), 'renderer feature must be a declared runtime entrypoint');
    assert.match(bindings, /bindProcedureBuilder\(deps\);/, 'facade must still bind the builder');
    assert.doesNotMatch(bindings, /#procedureStepPalette/, 'procedure DOM wiring must not live in the shared facade');

    // Bridge surface: preload exposes the four procedure channels only.
    for (const method of ['procedureCatalog', 'procedureValidate', 'procedureDryRun', 'procedureSave']) {
        assert.match(preload, new RegExp(`${method}:`), method);
    }

    // Renderer never re-declares a step schema: it renders the catalog it gets.
    assert.match(app, /MCbotTypedModuleEditor\.render\(step, descriptor, catalog, esc\)/);
    assert.match(app, /window\.MCbotTypedModuleEditor\.read\(row, type\)/);
    assert.doesNotMatch(app, /case 'open-gui': return \{ type, guiId/, 'step parameter defaults must not become a second schema');

    // Backend owner: save persists through the generic config-group transaction.
    assert.match(controller, /saveConfigGroup\('procedures', next\)/);
    assert.match(controller, /#procedureBuilder\(\)/);
});

test('G20 builder page exposes add/remove/reorder/validate/dry-run/save controls', () => {
    for (const id of ['procedureSelect', 'procedureId', 'procedureQuantityStrategy', 'procedureMaxBatch',
        'procedureStepPalette', 'procedureSteps', 'procedureClearSteps', 'procedureValidate',
        'procedureDryRun', 'procedureSave', 'procedureJson', 'procedureApplyJson', 'procedureSimulation']) {
        assert.match(html, new RegExp(`id="${id}"`), id);
    }
    assert.match(app, /data-procedure-action="remove"/);
    assert.match(app, /data-procedure-action="up"/);
    assert.match(app, /data-procedure-action="down"/);
    assert.match(app, /data-procedure-add="/);
    assert.match(html, /id="page-builder"/);
});

test('G20 procedure builder bindings module owns its own wiring and stays frozen', () => {
    const module = require(path.join(root, BINDINGS_MODULE));
    assert.deepEqual(Object.keys(module), ['create']);
    assert.ok(Object.isFrozen(module));
    const created = module.create({});
    assert.deepEqual(Object.keys(created), ['bind']);
    assert.ok(Object.isFrozen(created));
});

test('G20 bindings forward the injected deps and wire every procedure control', () => {
    const module = require(path.join(root, BINDINGS_MODULE));
    const wired = [];
    function element(selector) {
        const id = String(selector).replace(/^#/, '');
        return {
            addEventListener: type => wired.push(`${id}:${type}`),
            set onclick(handler) { wired.push(`${id}:onclick`); },
            set oninput(handler) { wired.push(`${id}:oninput`); },
            set onchange(handler) { wired.push(`${id}:onchange`); }
        };
    }
    const deps = {
        state: { procedureDraft: null, procedures: {} },
        toast: () => {},
        api: async value => value,
        runAction: async () => {},
        defaultProcedureStep: () => ({ type: 'click' }),
        newProcedureDraft: () => ({ id: '', steps: [] }),
        procedureDraftFromBuilder: () => ({ id: 'p', steps: [] }),
        fillProcedureBuilder: () => {},
        renderProcedurePalette: () => {},
        changeProcedureStep: () => {},
        loadProcedureBuilder: async () => {},
        $: element
    };

    assert.deepEqual(module.create(deps).bind(), { bound: true });
    // The facade delegates, so a missing deps injection must surface as a real
    // failure instead of silently skipping the builder (bind() throws).
    assert.throws(() => module.create(undefined).bind(), TypeError);
    for (const id of ['procedureStepPalette', 'procedureSteps', 'procedureStepSearch', 'procedureNew',
        'procedureSelect', 'procedureClearSteps', 'procedureApplyJson', 'procedureValidate',
        'procedureDryRun', 'procedureSave']) {
        assert.ok(wired.some(entry => entry.startsWith(`${id}:`)), `${id} must be wired`);
    }
    assert.equal(wired.filter(entry => entry === 'procedureSteps:change').length, 1);
    assert.equal(wired.filter(entry => entry === 'procedureSteps:click').length, 1);
});
