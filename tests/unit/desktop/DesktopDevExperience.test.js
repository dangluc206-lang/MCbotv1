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
test('normalizeEnvelope infers subsystem and severity from eventType', () => {
    const { normalizeEnvelope } = require('../../../src/desktop/events/EventInspectorBridge');
    const record = normalizeEnvelope({ eventType: 'connection:spawned', botId: 'bot-01', connectionGeneration: 3, attemptEpoch: 1, payload: { host: 'mc.example.com' } });
    assert.equal(record.subsystem, 'connection');
    assert.equal(record.severity, 'info');
    assert.equal(record.botId, 'bot-01');
    assert.equal(record.generation, 3);
    assert.equal(record.attemptEpoch, 1);
    assert.equal(record.source, 'connection');
    assert.ok(record.eventId.startsWith('evt-'));
    assert.equal(typeof record.timestamp, 'number');
    assert.deepEqual(record.payload, { host: 'mc.example.com' });
});

test('normalizeEnvelope redacts sensitive payload keys', () => {
    const { normalizeEnvelope } = require('../../../src/desktop/events/EventInspectorBridge');
    const record = normalizeEnvelope({ eventType: 'connection:login', botId: 'bot-01', payload: { username: 'steve', password: 's3cret', token: 'abc123' } });
    assert.equal(record.payload.username, 'steve');
    assert.equal(record.payload.password, '[REDACTED]');
    assert.equal(record.payload.token, '[REDACTED]');
});

test('normalizeEnvelope rejects records without eventType', () => {
    const { normalizeEnvelope } = require('../../../src/desktop/events/EventInspectorBridge');
    assert.equal(normalizeEnvelope({}), null);
    assert.equal(normalizeEnvelope({ botId: 'bot-01' }), null);
    assert.equal(normalizeEnvelope(null), null);
});

test('inferSubsystem maps every taxonomy prefix', () => {
    const { inferSubsystem } = require('../../../src/desktop/events/EventInspectorBridge');
    assert.equal(inferSubsystem('connection:spawned'), 'connection');
    assert.equal(inferSubsystem('reconnect:scheduled'), 'reconnect');
    assert.equal(inferSubsystem('mode:collector-b5:paused'), 'mode');
    assert.equal(inferSubsystem('operation:step'), 'operation');
    assert.equal(inferSubsystem('gui:opened'), 'gui');
    assert.equal(inferSubsystem('inventory:delta'), 'inventory');
    assert.equal(inferSubsystem('storage:protected'), 'storage');
    assert.equal(inferSubsystem('kho:sell'), 'storage');
    assert.equal(inferSubsystem('b1:normalize'), 'storage');
    assert.equal(inferSubsystem('crafting:recipe'), 'crafting');
    assert.equal(inferSubsystem('recipe:lookup'), 'crafting');
    assert.equal(inferSubsystem('movement:position'), 'movement');
    assert.equal(inferSubsystem('skyblock:gateway:succeeded'), 'skyblock');
    assert.equal(inferSubsystem('resource-pack:accepted'), 'skyblock');
    assert.equal(inferSubsystem('server-login:started'), 'skyblock');
    assert.equal(inferSubsystem('player:death'), 'skyblock');
    assert.equal(inferSubsystem('fishing:packet-observation'), 'mode');
    assert.equal(inferSubsystem('command:message'), 'mode');
    assert.equal(inferSubsystem('runtime:failure'), 'operation');
    assert.equal(inferSubsystem(''), 'mode');
});

test('inferSeverity classifies error/warn/debug/info', () => {
    const { inferSeverity } = require('../../../src/desktop/events/EventInspectorBridge');
    assert.equal(inferSeverity('connection:failed'), 'error');
    assert.equal(inferSeverity('connection:kicked'), 'error');
    assert.equal(inferSeverity('reconnect:scheduled'), 'warn');
    assert.equal(inferSeverity('reconnect:attempting'), 'warn');
    assert.equal(inferSeverity('gui:updated'), 'debug');
    assert.equal(inferSeverity('inventory:observed'), 'debug');
    assert.equal(inferSeverity('connection:spawned'), 'info');
    assert.equal(inferSeverity('mode:collector-b5:cycle-completed'), 'info');
});

test('EventInspectorBridge only dispatches known event names', () => {
    const { EventInspectorBridge } = require('../../../src/desktop/events/EventInspectorBridge');
    const seen = [];
    const handlers = {};
    const mockBus = { on: (name, handler) => { handlers[name] = handler; return () => {}; } };
    const bridge = new EventInspectorBridge({ sharedEventBus: mockBus, listener: record => seen.push(record) });
    bridge.watchAll();
    handlers['connection:spawned']({ eventType: 'connection:spawned', botId: 'bot-01', connectionGeneration: 1, payload: { ok: true } });
    handlers['reconnect:attempting']({ eventType: 'reconnect:attempting', botId: 'bot-01', connectionGeneration: 1, payload: { n: 2 } });
    assert.equal(seen.filter(record => record.eventType === 'connection:spawned').length, 1);
    assert.equal(seen.filter(record => record.eventType === 'reconnect:attempting').length, 1);
    bridge.unwatch();
    assert.equal(bridge.events.length, 0, 'unwatch clears the buffer');
});

test('EventInspectorBridge snapshot returns a copy and respects limit', () => {
    const { EventInspectorBridge } = require('../../../src/desktop/events/EventInspectorBridge');
    const handlers = {};
    const mockBus = { on: (name, handler) => { handlers[name] = handler; return () => {}; } };
    const bridge = new EventInspectorBridge({ sharedEventBus: mockBus, maxEvents: 50 });
    bridge.watchAll();
    handlers['connection:spawned']({ eventType: 'connection:spawned', botId: 'bot-01', connectionGeneration: 1, payload: { n: 1 } });
    const snap = bridge.snapshot({ limit: 10 });
    assert.equal(snap.length, 1);
    snap.push({ eventType: 'injected' });
    assert.equal(bridge.events.length, 1, 'snapshot must not mutate the internal buffer');
    assert.equal(bridge.snapshot({ limit: 1000 }).length, 1);
    bridge.unwatch();
});

test('EventInspectorBridge onEvent replaces listener and returns unsubscribe', () => {
    const { EventInspectorBridge } = require('../../../src/desktop/events/EventInspectorBridge');
    const second = [];
    const handlers = {};
    const mockBus = { on: (name, handler) => { handlers[name] = handler; return () => {}; } };
    const bridge = new EventInspectorBridge({ sharedEventBus: mockBus });
    bridge.watchAll();
    const off = bridge.onEvent(record => second.push(record));
    handlers['connection:spawned']({ eventType: 'connection:spawned', botId: 'bot-01', connectionGeneration: 1, payload: {} });
    assert.ok(second.length >= 1, 'listener must receive the dispatched event');
    off();
    assert.equal(bridge.listener, null);
    bridge.unwatch();
});

test('DevPages.eventLine renders event fields, escapes html, and exposes raw json + copy', () => {
    const record = { eventId: 'evt-123', eventType: 'connection:spawned', timestamp: new Date().toISOString(), botId: 'bot-01', generation: 3, attemptEpoch: 1, source: 'connection', subsystem: 'connection', severity: 'info', payload: { host: 'mc.example.com', msg: '<script>alert(1)</script>' } };
    const html = DevPages.eventLine(record);
    assert.ok(html.includes('evt-123'), 'event id must render');
    assert.ok(html.includes('connection:spawned'), 'event type must render');
    assert.ok(html.includes('bot=bot-01'), 'botId meta must render');
    assert.ok(html.includes('gen=3'), 'generation meta must render');
    assert.ok(html.includes('attempt=1'), 'attemptEpoch meta must render');
    assert.ok(html.includes('source=connection'), 'source meta must render');
    assert.ok(html.includes('subsystem=connection'), 'subsystem meta must render');
    assert.ok(html.includes('data-event-id="evt-123"'), 'copy data attribute must render');
    assert.ok(html.includes('data-event-copy="evt-123"'), 'copy button data attribute must render');
    assert.ok(html.includes('event-raw'), 'raw json details must render');
    assert.ok(html.includes('Xem JSON'), 'raw json summary label must render');
    assert.ok(!html.includes('<script>alert(1)</script>'));
    assert.ok(html.includes('&lt;script&gt;'), 'script tag must be html-escaped in raw json');
    assert.ok(html.includes('event-line info'));
});

test('DevPages.eventStream renders multiple events and empty state', () => {
    const records = [
        { eventId: 'e1', eventType: 'connection:spawned', timestamp: new Date().toISOString(), botId: 'bot-01', subsystem: 'connection', severity: 'info', payload: {} },
        { eventId: 'e2', eventType: 'connection:kicked', timestamp: new Date().toISOString(), botId: 'bot-02', subsystem: 'connection', severity: 'error', payload: {} }
    ];
    const html = DevPages.eventStream(records);
    assert.ok(html.includes('e1'));
    assert.ok(html.includes('e2'));
    assert.ok(html.includes('event-line error'));
    assert.ok(DevPages.eventStream([]).includes('dev-empty'));
});

test('EventInspectorBridge is constructible through the DesktopController import path', () => {
    // Regression for "DesktopRenderer EventInspectorBridge is not a constructor":
    // DesktopController previously assigned the whole frozen namespace object
    // (not the class) and called `new` on it at backend start.
    const mod = require('../../../src/desktop/events/EventInspectorBridge');
    assert.equal(typeof mod, 'object', 'module must export a named namespace');
    assert.equal(typeof mod.EventInspectorBridge, 'function', 'named export must be the class');
    const instance = new mod.EventInspectorBridge({ listener: () => {} });
    assert.equal(typeof instance.watchAll, 'function');
    assert.equal(typeof instance.snapshot, 'function');
    assert.equal(typeof instance.onEvent, 'function');
    assert.deepEqual(instance.snapshot(), []);
});

test('bridge consumers destructure the named export instead of re-exporting the namespace', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const desktopDir = path.join(__dirname, '..', '..', '..', 'src', 'desktop');
    const offenders = [];
    const walk = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.js')) {
                const src = fs.readFileSync(full, 'utf8');
                for (const match of src.matchAll(/require\(\s*(['"])([^'"]*events[\\\/]EventInspectorBridge)\1\s*\)/g)) {
                    const before = src.slice(Math.max(0, match.index - 200), match.index);
                    const after = src.slice(match.index + match[0].length, match.index + match[0].length + 40);
                    // Valid forms: destructuring before the require (single or multi
                    // line), or direct property access after it. Anything else means
                    // the whole namespace object was bound and `new` would throw.
                    const destructured = /\{\s*[^{}]*EventInspectorBridge[^{}]*\}\s*=\s*$/.test(before);
                    const propertyAccess = /^\s*\.\s*EventInspectorBridge/.test(after);
                    if (!destructured && !propertyAccess) {
                        offenders.push(`${path.relative(desktopDir, full)}: ${src.slice(before.length + match.index, match.index + match[0].length + after.length).split(/\r?\n/)[0].trim()}`);
                    }
                }
            }
        }
    };
    walk(desktopDir);
    assert.deepEqual(offenders, [],
        'require of EventInspectorBridge module must destructure the class: const { EventInspectorBridge } = require(...)');
});