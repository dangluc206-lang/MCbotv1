'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const DesktopController = require('../../../src/desktop/DesktopController');
const DesktopLogPolicy = require('../../../src/desktop/DesktopLogPolicy');
const Router = require('../../../src/desktop/renderer/core/RendererRouter');
const DevRouter = require('../../../src/desktop/renderer/core/DevRouter');
const Catalog = require('../../../src/desktop/renderer/pages/PageCatalog');
const DevPages = require('../../../src/desktop/renderer/features/dev/DevPages');

test('router blocks DEV pages at standard experience and allows them at advanced', () => {
    assert.equal(Router.allowed('events', 'standard', Catalog), 'dashboard');
    assert.equal(Router.allowed('inspector', 'standard', Catalog), 'dashboard');
    assert.equal(Router.allowed('events', 'advanced', Catalog), 'events');
    assert.equal(Router.allowed('inspector', 'advanced', Catalog), 'inspector');
    assert.equal(Router.allowed('dashboard', 'standard', Catalog), 'dashboard');
    assert.equal(Router.allowed('incidents', 'standard', Catalog), 'incidents');
    // Legacy 'ADVANCED' group from older catalogs is treated as DEV.
    const legacy = { tools: { title: 't', subtitle: 's', group: 'ADVANCED' } };
    assert.equal(Router.allowed('tools', 'standard', legacy), 'dashboard');
    assert.equal(Router.allowed('tools', 'advanced', legacy), 'tools');
});

test('page catalog exposes USER and DEV groups and every page is grouped', () => {
    for (const [page, entry] of Object.entries(Catalog)) {
        assert.ok(['USER', 'DEV'].includes(entry.group), `page ${page} must be USER or DEV`);
    }
    for (const page of ['dashboard', 'bots', 'bot-detail', 'modes', 'incidents', 'settings']) {
        assert.equal(Catalog[page].group, 'USER', `${page} must stay in USER experience`);
    }
    for (const page of ['dev-overview', 'inspector', 'events', 'logs', 'incident-debug', 'runtime-state', 'b5-debug', 'diagnostics', 'config-debug', 'builder', 'tools', 'ai']) {
        assert.equal(Catalog[page].group, 'DEV', `${page} must stay in DEV experience`);
    }
});

test('dev router exposes exactly 9 nav pages and blocks non-nav pages', () => {
    assert.equal(DevRouter.DEV_NAV.length, 9);
    assert.deepEqual(DevRouter.DEV_NAV, [
        'dev-overview', 'inspector', 'events', 'logs',
        'incident-debug', 'runtime-state', 'b5-debug', 'diagnostics', 'config-debug'
    ]);
    // builder/tools/ai are DEV group but not in Dev nav.
    assert.equal(DevRouter.isDevNavPage('builder'), false);
    assert.equal(DevRouter.isDevNavPage('tools'), false);
    assert.equal(DevRouter.isDevNavPage('ai'), false);
    assert.equal(DevRouter.isDevNavPage('dev-overview'), true);
    assert.equal(DevRouter.isDevNavPage('config-debug'), true);
});

test('dev log stream receives sanitized records pre-fold while operator stream stays folded', () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-dev-logs-'));
    try {
        const controller = new DesktopController({
            baseDir,
            // Long repeat window: the operator projection folds the duplicate.
            logPolicy: new DesktopLogPolicy({ repeatWindowMs: 60000 })
        });
        const devSeen = [];
        controller.onDevLog(record => devSeen.push(record));
        controller.reportRendererError({ message: 'explode once', source: 'test' });
        controller.reportRendererError({ message: 'explode once', source: 'test' });
        assert.equal(devSeen.length, 2, 'dev stream must see every record pre-fold');
        assert.equal(devSeen[0].message, 'explode once');
        assert.equal(devSeen[0].level, 'error');
        assert.equal(controller.devLogSnapshot({ limit: 10 }).length, 2);
        // The operator stream folds duplicates; it must never be larger than dev.
        assert.ok(controller.logSnapshot({ limit: 10 }).length <= devSeen.length);
    } finally {
        fs.rmSync(baseDir, { recursive: true, force: true });
    }
});

test('dev-only endpoints require a running backend', () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-dev-logs-'));
    try {
        const controller = new DesktopController({ baseDir });
        // Stopped backend: either the running guard or the bot lookup fails closed.
        assert.throws(() => controller.botDevDetail('bot-01'), /not running|does not exist/);
        assert.throws(() => controller.b5Trace('bot-01'), /not running/);
    } finally {
        fs.rmSync(baseDir, { recursive: true, force: true });
    }
});

test('dev presenters escape html and build the incident timeline', () => {
    const escaped = DevPages.logLine({
        timestamp: new Date().toISOString(),
        level: 'warn',
        scope: 'Bot<script>',
        message: 'boom & <b>gone</b>'
    });
    assert.ok(!escaped.includes('<b>gone</b>'));
    // Entity string assembled at runtime so editor formatting cannot strip it.
    const AMP = String.fromCharCode(38);
    assert.ok(escaped.includes(`${AMP}lt;b${AMP}gt;gone${AMP}lt;/b${AMP}gt;`));

    const timeline = DevPages.incidentTimeline({
        id: 'inc-1',
        code: 'CRAFTING_X',
        severity: 'HIGH',
        state: 'OPEN',
        botId: 'bot-01',
        generation: 4,
        evidenceRefs: ['artifact-a', 'artifact-b'],
        history: [{ state: 'RECOVERING', reason: 'retry-storage-protection' }]
    }, null);
    assert.ok(timeline.includes('CRAFTING_X'));
    assert.ok(timeline.includes('artifact-b'));
    assert.ok(timeline.includes('retry-storage-protection'));
});

test('dev logLine renders stack trace in a collapsible details block', () => {
    const AMP = String.fromCharCode(38);
    const rendered = DevPages.logLine({
        timestamp: new Date().toISOString(),
        level: 'error',
        scope: 'BotRuntime:bot-01',
        message: 'boom',
        meta: {
            botId: 'bot-01',
            code: 'CRAFTING_X',
            stack: 'Error: boom\n    at src/foo.js:10:5\n    at src/bar.js:20:7\n    at <script>injected</script>'
        }
    });
    assert.ok(rendered.includes('log-stack'), 'stack block must be present');
    assert.ok(rendered.includes('Stack trace'), 'summary label must be present');
    assert.ok(rendered.includes('src/foo.js:10:5'), 'stack frame must be visible');
    // Stack content must be escaped, not injected as HTML.
    assert.ok(!rendered.includes('<script>'));
    assert.ok(rendered.includes(`${AMP}lt;script${AMP}gt;`));
});

test('dev logLine renders nested error.stack from meta.error', () => {
    const rendered = DevPages.logLine({
        timestamp: new Date().toISOString(),
        level: 'error',
        scope: 'Desktop',
        message: 'backend failed',
        meta: {
            error: {
                name: 'Error',
                message: 'backend failed',
                stack: 'Error: backend failed\n    at src/desktop/DesktopController.js:185:19'
            }
        }
    });
    assert.ok(rendered.includes('log-stack'));
    assert.ok(rendered.includes('DesktopController.js:185:19'));
});

test('dev logLine shows all metadata keys without the 6-key cap', () => {
    const rendered = DevPages.logLine({
        timestamp: new Date().toISOString(),
        level: 'info',
        scope: 'B5',
        message: 'cycle',
        meta: {
            botId: 'bot-01',
            code: 'B5_OK',
            reason: 'done',
            phase: 'CRAFTING',
            operation: 'b5-cycle',
            step: 'B5',
            resource: 'iron',
            recipeId: 'b5-1',
            extraKey: 'extra-value'
        }
    });
    assert.ok(rendered.includes('extraKey=extra-value'), 'all meta keys must render');
    assert.ok(rendered.includes('recipeId=b5-1'));
    assert.ok(rendered.includes('step=B5'));
});

test('dev pages expose all 9 presenters plus stateView helper', () => {
    const expected = ['stateView', 'fleetRows', 'botDetail', 'logLine', 'incidentTimeline',
        'inspectorView', 'eventStream', 'logStream', 'runtimeStateView',
        'b5DebugView', 'diagnosticsView', 'configDebugView'];
    for (const name of expected) {
        assert.equal(typeof DevPages[name], 'function', `${name} must be a function`);
    }
});

test('stateView helper renders loading, empty, error and content states', () => {
    const loading = DevPages.stateView({ loading: true });
    assert.ok(loading.includes('dev-loading'));
    assert.ok(loading.includes('Đang tải'));

    const empty = DevPages.stateView({ empty: 'Không có dữ liệu' });
    assert.ok(empty.includes('dev-empty'));
    assert.ok(empty.includes('Không có dữ liệu'));

    const error = DevPages.stateView({ error: 'Lỗi <script>' });
    assert.ok(error.includes('dev-error'));
    assert.ok(!error.includes('<script>'));
    assert.ok(error.includes('Lỗi'));

    const content = DevPages.stateView({ content: '<div>nội dung</div>' });
    assert.equal(content, '<div>nội dung</div>');
});

test('dev presenters handle empty inputs with stateView', () => {
    assert.ok(DevPages.fleetRows([], () => {}).includes('dev-empty'));
    assert.ok(DevPages.eventStream([]).includes('dev-empty'));
    assert.ok(DevPages.logStream([]).includes('dev-empty'));
    assert.ok(DevPages.runtimeStateView(null).includes('dev-empty'));
    assert.ok(DevPages.inspectorView(null).includes('dev-empty'));
    assert.ok(DevPages.diagnosticsView([]).includes('dev-empty'));
    assert.ok(DevPages.configDebugView(null).includes('dev-empty'));
});