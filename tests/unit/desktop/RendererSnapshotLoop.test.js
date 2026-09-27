'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const snapshotLoop = require(path.join(ROOT, 'src/desktop/renderer/core/RendererSnapshotLoop.js'));
const presenter = require(path.join(ROOT, 'src/desktop/renderer/features/operator/OperatorPresenter.js'));

// The loop was extracted out of app.js, which now injects the store, the DOM
// helper and the page renderers. Behavior must stay identical, so these checks
// drive the real loop against a minimal fake DOM.
function makeElement(id) {
    const element = {
        id,
        textContent: '',
        className: '',
        disabled: false,
        stale: false,
        classList: {
            toggle(name, on) { if (name === 'stale') element.stale = Boolean(on); },
            contains: name => name === 'stale' && element.stale
        },
        querySelector: () => (element.strong || (element.strong = { textContent: '' }))
    };
    return element;
}

function makeDom() {
    const elements = new Map();
    return {
        $: selector => {
            if (!elements.has(selector)) elements.set(selector, makeElement(selector.slice(1)));
            return elements.get(selector);
        },
        el: id => elements.get(`#${id}`)
    };
}

function makeState(overrides = {}) {
    return Object.assign({
        snapshot: null,
        page: 'dashboard',
        devPage: '',
        preferences: {},
        renderScheduled: false,
        lastSnapshotReceivedAt: null
    }, overrides);
}

function installFrames() {
    const frames = [];
    const previous = global.requestAnimationFrame;
    global.requestAnimationFrame = callback => frames.push(callback);
    return { frames, flush: () => frames.splice(0).forEach(callback => callback()), restore: () => { global.requestAnimationFrame = previous; } };
}

function makeLoop(state, dom, extra = {}) {
    const calls = { dashboard: 0, modes: 0, devOverview: 0, sync: 0, loadStaticData: 0, toasts: [] };
    const loop = snapshotLoop.create({
        state,
        $: dom.$,
        api: extra.api || (async () => ({})),
        toast: message => calls.toasts.push(message),
        viPhase: presenter.viPhase,
        formatDuration: presenter.formatDuration,
        syncSelectors: () => { calls.sync += 1; },
        loadStaticData: async () => { calls.loadStaticData += 1; },
        renderDashboard: () => { calls.dashboard += 1; },
        renderModes: () => { calls.modes += 1; },
        renderDevOverview: () => { calls.devOverview += 1; }
    });
    return { loop, calls };
}

test('snapshot loop is loaded before the renderer entry point', () => {
    const html = fs.readFileSync(path.join(ROOT, 'src/desktop/renderer/index.html'), 'utf8');
    assert.match(html, /<script src="core\/RendererSnapshotLoop\.js"><\/script>/);
    assert.ok(
        html.indexOf('core/RendererSnapshotLoop.js') < html.indexOf('src="app.js"'),
        'RendererSnapshotLoop must be loaded before app.js'
    );
    const app = fs.readFileSync(path.join(ROOT, 'src/desktop/renderer/app.js'), 'utf8');
    assert.match(app, /window\.MCbotRendererSnapshotLoop\.create\(/);
    // The desktop e2e harness calls renderFreshness() by bare global name.
    assert.match(app, /function renderFreshness\(\)/);
    assert.doesNotMatch(app, /function renderBackend\(\)/);
});

test('acceptSnapshot stores the snapshot, stamps arrival and schedules exactly one frame', () => {
    const frames = installFrames();
    try {
        const state = makeState();
        const dom = makeDom();
        const { loop } = makeLoop(state, dom);
        loop.acceptSnapshot({ lifecycle: 'RUNNING', bots: [], system: {} });
        loop.acceptSnapshot({ lifecycle: 'RUNNING', bots: [], system: {} });
        assert.equal(state.renderScheduled, true);
        assert.equal(frames.frames.length, 1, 'two snapshots inside one frame must coalesce into one render');
        frames.flush();
        assert.equal(state.renderScheduled, false, 'the flag must clear after the frame runs');
        assert.ok(state.lastSnapshotReceivedAt > 0);
        loop.acceptSnapshot(null);
        assert.equal(state.renderScheduled, false, 'a null snapshot must be ignored');
    } finally { frames.restore(); }
});

test('acceptSnapshot only triggers the static data load on the transition into RUNNING', () => {
    const frames = installFrames();
    try {
        const state = makeState();
        const dom = makeDom();
        const { loop, calls } = makeLoop(state, dom);
        loop.acceptSnapshot({ lifecycle: 'STOPPED' });
        loop.acceptSnapshot({ lifecycle: 'STOPPED' });
        assert.equal(calls.loadStaticData, 0);
        loop.acceptSnapshot({ lifecycle: 'RUNNING' });
        assert.equal(calls.loadStaticData, 1, 'STOPPED -> RUNNING must load static data once');
        loop.acceptSnapshot({ lifecycle: 'RUNNING' });
        assert.equal(calls.loadStaticData, 1, 'RUNNING -> RUNNING must not reload');
        frames.flush();
    } finally { frames.restore(); }
});

test('the animation frame repaints backend, selectors, the active page and freshness', () => {
    const frames = installFrames();
    try {
        const state = makeState({ page: 'modes', devPage: 'dev-overview' });
        const dom = makeDom();
        const { loop, calls } = makeLoop(state, dom);
        loop.scheduleDynamicRender();
        frames.flush();
        assert.equal(calls.sync, 1);
        assert.equal(calls.modes, 1, 'the modes page must repaint on a snapshot tick');
        assert.equal(calls.devOverview, 1);
        assert.equal(calls.dashboard, 0, 'inactive pages must not repaint');
        assert.equal(dom.el('backendState').textContent, 'Tắt');
        assert.ok(dom.el('updatedAt').textContent.length > 0);

        state.page = 'dashboard';
        state.devPage = '';
        loop.scheduleDynamicRender();
        frames.flush();
        assert.equal(calls.dashboard, 1);
    } finally { frames.restore(); }
});

test('renderBackend maps lifecycle onto backend buttons and labels', () => {
    const frames = installFrames();
    try {
        const running = makeState({ snapshot: { lifecycle: 'RUNNING', bots: [1, 2], system: { memoryMb: 512, uptimeMs: 3_600_000 } } });
        const runningDom = makeDom();
        makeLoop(running, runningDom).loop.renderBackend();
        assert.equal(runningDom.el('backendState').textContent, 'Đang chạy');
        assert.equal(runningDom.el('sidebarFleet').textContent, '2 bot');
        assert.equal(runningDom.el('sidebarMemory').textContent, '512 MB');
        assert.equal(runningDom.el('settingsUptime').textContent, '1h 0m');
        assert.equal(runningDom.el('startBackend').disabled, true);
        assert.equal(runningDom.el('stopBackend').disabled, false);
        assert.equal(runningDom.el('restartBackend').disabled, false);

        const stopped = makeState();
        const stoppedDom = makeDom();
        makeLoop(stopped, stoppedDom).loop.renderBackend();
        assert.equal(stoppedDom.el('backendState').textContent, 'Tắt');
        assert.equal(stoppedDom.el('sidebarMemory').textContent, '— MB');
        assert.equal(stoppedDom.el('startBackend').disabled, false);
        assert.equal(stoppedDom.el('stopBackend').disabled, true);
        assert.equal(stoppedDom.el('restartBackend').disabled, false);
    } finally { frames.restore(); }
});

test('renderFreshness marks the shell stale past the configured threshold', () => {
    const frames = installFrames();
    try {
        const state = makeState({ lastSnapshotReceivedAt: Date.now(), snapshot: { updatedAt: new Date().toISOString() } });
        const dom = makeDom();
        const { loop } = makeLoop(state, dom);
        loop.renderFreshness();
        assert.equal(dom.el('liveState').stale, false);
        assert.equal(dom.el('liveState').strong.textContent, 'Trực tiếp');

        state.lastSnapshotReceivedAt = Date.now() - 60_000;
        loop.renderFreshness();
        assert.equal(dom.el('liveState').stale, true);
        assert.equal(dom.el('liveState').strong.textContent, 'Mất cập nhật trực tiếp');
        assert.match(dom.el('updatedAt').textContent, /^Lần cuối /);

        state.snapshot = null;
        loop.renderFreshness();
        assert.equal(dom.el('updatedAt').textContent, 'Chưa có bản chụp trạng thái');
    } finally { frames.restore(); }
});

test('refreshSnapshot reports failures unless the caller asked for a quiet refresh', async () => {
    const frames = installFrames();
    const previousWindow = global.window;
    try {
        global.window = { mcbot: { snapshot: async () => ({ lifecycle: 'RUNNING' }) } };
        const state = makeState();
        const { loop, calls } = makeLoop(state, makeDom(), { api: promise => promise });
        await loop.refreshSnapshot();
        assert.equal(state.snapshot.lifecycle, 'RUNNING');
        assert.deepEqual(calls.toasts, []);

        global.window = { mcbot: { snapshot: async () => { throw new Error('cầu nối lỗi'); } } };
        await loop.refreshSnapshot({ quiet: true });
        assert.deepEqual(calls.toasts, [], 'a quiet refresh must swallow the error');
        await loop.refreshSnapshot();
        assert.deepEqual(calls.toasts, ['cầu nối lỗi']);
    } finally {
        global.window = previousWindow;
        frames.restore();
    }
});
