'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const MODULE_PATH = 'src/desktop/renderer/features/bots/BotCardPresenter.js';
const presenter = require(path.join(ROOT, MODULE_PATH));

// The card markup was extracted out of app.js, which now only injects the
// projection helpers, the document, the craft request panel and a read-only
// registry getter. Behavior must stay identical, so these checks drive the real
// card builder against a minimal fake DOM.
function makeDeps(overrides = {}) {
    const panels = [];
    return Object.assign({
        esc: value => String(value ?? ''),
        document: { body: { dataset: { experience: 'standard' } } },
        connClass: status => String(status || '').toLowerCase(),
        viConnection: status => `Kết nối: ${status}`,
        viModeBadge: className => `badge:${className}`,
        viWaitingReason: reason => `chờ:${reason}`,
        position: player => `vị trí:${player?.x ?? '—'}`,
        activeOperation: () => ({ active: 1, name: 'Chế tạo', detail: 'chi tiết' }),
        connectionControlState: () => ({ online: false, connecting: false, wantsConnected: false, canConnect: true, canDisconnect: false }),
        modeInfo: () => ({ id: null, name: 'Đang rảnh', phase: 'Không có chế độ chính', paused: false, className: '', manualResume: false }),
        buttonHtml: ({ label, action, mode = '', disabled = false, title = '' }) => `<button data-action="${action}"${mode ? ` data-mode="${mode}"` : ''}${disabled ? ' disabled' : ''}${title ? ` title="${title}"` : ''}>${label}</button>`,
        craftingDraft: () => ({ itemId: '', quantity: '', all: false }),
        craftingItemsFor: () => [{ id: 'super_alloy', displayName: 'Super Alloy' }],
        CraftingRequestPanel: { render: options => { panels.push(options); return `<div data-craft-panel="${options.botId}"></div>`; } },
        renderedPanels: panels
    }, overrides);
}

function makeBot(overrides = {}) {
    return Object.assign({
        botId: 'bot-1',
        profile: { displayName: 'Nông trại', username: 'farmer', enabled: true },
        state: { connectionState: 'CONNECTED' },
        player: { health: 20, food: 18, ping: 32, x: 1, y: 64, z: 2, inventory: { slotsUsed: 10, itemCount: 100, slotsFreeApprox: 26 }, heldItem: { displayName: 'Kiếm' } },
        modes: { available: [{ definition: { id: 'crafting', label: 'Chế tạo' }, readiness: { ready: true } }] },
        connectionGeneration: 3
    }, overrides);
}


test('card presenter is loaded before the renderer entry point', () => {
    const html = fs.readFileSync(path.join(ROOT, 'src/desktop/renderer/index.html'), 'utf8');
    assert.match(html, /<script src="features\/bots\/BotCardPresenter\.js"><\/script>/);
    assert.ok(
        html.indexOf('features/bots/BotCardPresenter.js') < html.indexOf('src="app.js"'),
        'BotCardPresenter must be loaded before app.js'
    );
    const app = fs.readFileSync(path.join(ROOT, 'src/desktop/renderer/app.js'), 'utf8');
    assert.doesNotMatch(app, /function botCard\(/, 'botCard must not stay in the legacy facade');
    assert.match(app, /window\.MCbotBotCardPresenter\.create\(/);
    const source = fs.readFileSync(path.join(ROOT, MODULE_PATH), 'utf8');
    assert.ok(!source.includes('window.MCbot'), 'the presenter stays free of window.MCbot globals');
});

test('exposed surface is frozen and only owns the card builder', () => {
    assert.deepEqual(Object.keys(presenter).sort(), ['create']);
    assert.ok(Object.isFrozen(presenter), 'module exports must be frozen');
    const card = presenter.create(makeDeps());
    assert.deepEqual(Object.keys(card).sort(), ['botCard']);
    assert.equal(typeof card.botCard, 'function');
});

test('card headline renders identity, connection and vitals', () => {
    const html = presenter.create(makeDeps()).botCard(makeBot());
    assert.match(html, /<article class="bot-card">/);
    assert.match(html, /Nông trại/);
    assert.match(html, /Kết nối: CONNECTED/);
    assert.match(html, /Máu \/ thức ăn/);
    assert.match(html, /Kiếm/);
    assert.match(html, /data-action="connect"/);
});

test('mode start button self-connects while offline and hints the policy', () => {
    const html = presenter.create(makeDeps()).botCard(makeBot(), true);
    assert.match(html, /data-action="mode-start"/);
    assert.match(html, /tự kết nối/);
    assert.match(html, /title="Bật mode và tự kết nối bot\."/);
    assert.match(html, /data-action="mode-stop"/);
});

test('full mode actions exist only for the mode page', () => {
    const compact = presenter.create(makeDeps()).botCard(makeBot());
    assert.doesNotMatch(compact, /data-action="mode-pause"/);
    const full = presenter.create(makeDeps()).botCard(makeBot(), true);
    assert.match(full, /data-action="mode-pause"/);
    assert.match(full, /data-action="mode-resume"/);
    assert.match(full, /data-action="mode-restart"/);
    assert.match(full, /data-action="mode-stop"/);
});

test('request panel renders only in crafting mode with the registry cache', () => {
    const crafting = makeDeps({
        modeInfo: () => ({ id: 'crafting', name: 'Chế tạo', phase: 'Đang chế tạo', paused: false, className: 'running', manualResume: false })
    });
    const withPanel = presenter.create(crafting).botCard(makeBot({ modes: { available: [], crafting: { phase: 'RUNNING', details: { craftRequest: null } } } }));
    assert.match(withPanel, /data-craft-panel="bot-1"/, 'crafting mode must render the request panel');
    assert.equal(crafting.renderedPanels.length, 1);
    assert.deepEqual(crafting.renderedPanels[0].items, [{ id: 'super_alloy', displayName: 'Super Alloy' }]);

    const idle = presenter.create(makeDeps()).botCard(makeBot());
    assert.doesNotMatch(idle, /data-craft-panel=/, 'non-crafting modes must not mount the panel');
});



test('storage-protection retry only shows while the episode allows it', () => {
    const episode = { state: 'PENDING', totalAttempts: 1 };
    const grant = () => ({ id: 'crafting', name: 'Chế tạo', phase: 'Đang chế tạo', paused: false, className: 'running', manualResume: false });
    const retry = presenter.create(makeDeps({ modeInfo: grant })).botCard(makeBot({
        modes: { available: [], crafting: { phase: 'RUNNING', details: { protectionEpisode: episode, recovery: { allowedActions: ['retry-storage-protection'] } } } }
    }));
    assert.match(retry, /data-action="b5-retry-storage"/);

    const blocked = presenter.create(makeDeps({ modeInfo: grant })).botCard(makeBot({
        modes: { available: [], crafting: { phase: 'RUNNING', details: { protectionEpisode: episode, recovery: { allowedActions: [] } } } }
    }));
    assert.doesNotMatch(blocked, /data-action="b5-retry-storage"/, 'the button must stay hidden without the recovery grant');
});

test('advanced shell reveals the tech grid and the protection gate', () => {
    const future = Date.now() + 90_000;
    const craftingMode = () => ({ id: 'crafting', name: 'Chế tạo', phase: 'Đang chế tạo', paused: false, className: 'running', manualResume: false });
    const modes = { available: [], crafting: { phase: 'RUNNING', details: { protectionEpisode: { state: 'PENDING', totalAttempts: 2, nextEligibleAt: future, blocker: { resource: 'super_alloy', reason: 'storage-pressure', backoffMs: 12_000 } }, batchId: 'batch-7' } } };
    const html = presenter.create(makeDeps({ modeInfo: craftingMode, document: { body: { dataset: { experience: 'advanced' } } } })).botCard(makeBot({ modes }));
    assert.match(html, /Sky gateway/, 'advanced experience reveals the tech grid');
    assert.match(html, /Gate bảo vệ kho/);
    assert.match(html, /retry \d+ms/, 'the gate keeps its bounded retry countdown');

    const standard = presenter.create(makeDeps({ modeInfo: craftingMode })).botCard(makeBot({ modes }));
    assert.doesNotMatch(standard, /Sky gateway/, 'standard experience hides the tech grid');
});
