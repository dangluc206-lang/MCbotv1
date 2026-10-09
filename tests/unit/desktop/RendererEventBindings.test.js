'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const MODULE_PATH = 'src/desktop/renderer/core/RendererEventBindings.js';
const bindings = require(path.join(ROOT, MODULE_PATH));

// The event wiring was extracted out of app.js, which now only injects the
// store, the DOM helper and the action entry points. Behavior must stay
// identical, so these checks drive the real binder against a minimal fake DOM.
function makeElement() {
    const listeners = {};
    const element = {
        listeners,
        onclick: null,
        onchange: null,
        oninput: null,
        addEventListener: (type, handler) => {
            listeners[type] = listeners[type] || [];
            listeners[type].push(handler);
        },
        fire: (type, event) => (listeners[type] || []).forEach(handler => handler(event)),
    };
    return element;
}

function makeDom() {
    const elements = new Map();
    const documentListeners = {};
    return {
        document: {
            listeners: documentListeners,
            addEventListener: (type, handler) => {
                documentListeners[type] = documentListeners[type] || [];
                documentListeners[type].push(handler);
            },
            fire: (type, event) => (documentListeners[type] || []).forEach(handler => handler(event)),
        },
        $: selector => {
            if (!elements.has(selector)) elements.set(selector, makeElement());
            return elements.get(selector);
        },
        el: selector => elements.get(selector),
    };
}

function makeDeps(dom, overrides = {}) {
    const calls = { botAction: 0, fleetAction: 0, nav: [], draft: 0 };
    return {
        deps: Object.assign({
            document: dom.document,
            state: { preferences: null, incidents: [], selectedIncidentId: null },
            $: dom.$,
            api: async value => value,
            toast: () => {},
            esc: value => String(value ?? ''),
            pageTitles: { dashboard: 'Dashboard', logs: 'Logs' },
            handleBotAction: async () => { calls.botAction += 1; },
            handleFleetAction: async () => { calls.fleetAction += 1; },
            switchPage: page => { calls.nav.push(page); },
            switchDevPage: () => {},
            openCommandPalette: async () => {},
            renderCommandPalette: async () => {},
            renderFirstRun: () => {},
            renderIncidents: () => {},
            loadIncidents: async () => {},
            loadCraftJourney: async () => {},
            renderBotDetail: () => {},
            renderInspector: async () => {},
            renderEventStream: () => {},
            copyEventRecord: async () => {},
            renderIncidentDebug: () => {},
            renderIncidentDebugDetail: async () => {},
            renderRuntimeState: () => {},
            renderCraftDebug: async () => {},
            loadConfigDebug: async () => {},
            loadProfiles: async () => {},
            loadCommands: async () => {},
            loadStaticData: async () => {},
            loadSkyCommands: async () => {},
            renderSkyCommands: () => {},
            clearSkyCommandEditor: () => {},
            saveSkyCommandFromEditor: async () => ({}),
            renderLogs: () => {},
            scheduleLogRender: () => {},
            updateLogUnread: () => {},
            refreshDiagnostics: () => {},
            loadFishingConfig: async () => {},
            fillFishingArea: () => {},
            renderUpdateStatus: () => {},
            loadAdvancedConfig: async () => {},
            previewAdvancedConfig: async () => {},
            saveAdvancedConfig: async () => ({}),
            undoAdvancedConfig: async () => ({}),
            loadBackupCatalog: async () => {},
            loadCraftConfig: async () => {},
            saveCraftConfig: async () => ({}),
            loadStorageProtection: async () => {},
            saveStorageProtection: async () => ({}),
            defaultModuleStep: () => ({}),
            newCustomDraft: () => ({}),
            draftFromBuilder: () => ({}),
            fillCustomBuilder: () => {},
            renderModulePalette: () => {},
            customModeEntryId: () => '',
            loadCustomModeCatalog: async () => {},
            changeWorkflowStep: () => {},
            runAction: async ({ fn }) => fn(),
            refreshSnapshot: async () => {},
            confirmInApp: async () => true,
            reportRendererError: () => {},
            captureCraftingDraft: () => { calls.draft += 1; },
            applyPresentationPreferences: () => {},
            clearEventView: () => {},
        }, overrides),
        calls,
    };
}

function closestFor(action) {
    return selector => {
        if (selector === '[data-action]' && action === 'bot') return { dataset: {} };
        if (selector === '[data-fleet-action]' && action === 'fleet') return { dataset: {} };
        if (selector === '.nav-item' && action === 'nav') return { dataset: { page: 'logs' } };
        if (selector === '[data-craft-request-bot]' && action === 'draft') return { dataset: {} };
        return null;
    };
}

test('event bindings are loaded before the renderer entry point', () => {
    const html = fs.readFileSync(path.join(ROOT, 'src/desktop/renderer/index.html'), 'utf8');
    assert.match(html, /<script src="core\/RendererEventBindings\.js"><\/script>/);
    assert.ok(
        html.indexOf('core/RendererEventBindings.js') < html.indexOf('src="app.js"'),
        'RendererEventBindings must be loaded before app.js'
    );
    const app = fs.readFileSync(path.join(ROOT, 'src/desktop/renderer/app.js'), 'utf8');
    assert.match(app, /window\.MCbotRendererEventBindings\.create\(/);
    assert.doesNotMatch(app, /function bindEvents\(/, 'bindEvents must not stay in the legacy facade');
    const source = fs.readFileSync(path.join(ROOT, MODULE_PATH), 'utf8');
    assert.match(source, /bindEvents:\s*\(\)\s*=>/);
});

test('exposed surface is frozen and only owns the binder', () => {
    assert.deepEqual(Object.keys(bindings).sort(), ['create']);
    assert.ok(Object.isFrozen(bindings), 'module exports must be frozen');
    const dom = makeDom();
    const { deps } = makeDeps(dom);
    const created = bindings.create(deps);
    assert.deepEqual(Object.keys(created), ['bindEvents']);
    assert.ok(Object.isFrozen(created), 'created surface must be frozen');
});

test('create() performs no DOM wiring until bindEvents() runs', () => {
    const dom = makeDom();
    const { deps } = makeDeps(dom);
    bindings.create(deps);
    assert.deepEqual(dom.document.listeners, {}, 'no document listeners before bindEvents()');
    assert.equal(dom.el('#nav'), undefined, 'no element lookup before bindEvents()');
    bindings.create(deps).bindEvents();
    assert.ok((dom.document.listeners.click || []).length > 0, 'click delegation is bound');
});

test('click delegation routes bot and fleet actions', async () => {
    const dom = makeDom();
    const { deps, calls } = makeDeps(dom);
    bindings.create(deps).bindEvents();
    dom.document.fire('click', { target: { closest: closestFor('bot') } });
    dom.document.fire('click', { target: { closest: closestFor('fleet') } });
    await Promise.resolve();
    assert.equal(calls.botAction, 1);
    assert.equal(calls.fleetAction, 1);
});

test('navigation and global keys route through injected entry points', () => {
    const dom = makeDom();
    const { deps, calls } = makeDeps(dom);
    bindings.create(deps).bindEvents();
    dom.el('#nav').fire('click', { target: { closest: closestFor('nav') } });
    assert.deepEqual(calls.nav, ['logs']);
    const keydown = dom.document.listeners.keydown[0];
    keydown({ ctrlKey: true, metaKey: false, shiftKey: false, key: 'l', preventDefault: () => {} });
    assert.deepEqual(calls.nav, ['logs', 'logs']);
    dom.document.fire('input', { target: { closest: closestFor('draft') } });
    assert.equal(calls.draft, 1);
});

