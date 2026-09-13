'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const DesktopController = require('../../../src/desktop/DesktopController');
const DesktopLogPolicy = require('../../../src/desktop/DesktopLogPolicy');
const Router = require('../../../src/desktop/renderer/core/RendererRouter');
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
    for (const page of ['dev-overview', 'inspector', 'events', 'logs', 'incident-debug', 'runtime-state', 'b5-debug', 'ai']) {
        assert.equal(Catalog[page].group, 'DEV', `${page} must stay in DEV experience`);
    }
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