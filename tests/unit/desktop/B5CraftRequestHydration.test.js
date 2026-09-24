'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.resolve(__dirname, '../../../src/desktop/renderer/app.js'), 'utf8');
const panel = fs.readFileSync(path.resolve(__dirname, '../../../src/desktop/renderer/features/crafting/CraftingRequestPanel.js'), 'utf8');

function hydrateBody() {
    const start = renderer.indexOf('async function hydrateCraftingItems()');
    assert.ok(start >= 0, 'hydrateCraftingItems must exist');
    const end = renderer.indexOf('\nfunction renderDashboard()', start);
    return renderer.slice(start, end);
}

// Regression: the select was rendered with a placeholder <option>, so
// `!select.options.length` was always false and the registry list never reached
// the UI.
test('hydrate never gates the item list on the option count', () => {
    const body = hydrateBody();
    assert.doesNotMatch(body, /!select\.options\.length/);
    assert.doesNotMatch(body, /select\.options\.length/);
    assert.match(body, /optionsHtml\(items, draft, esc\)/);
});

test('hydrate drives itself from rendered panels and per-bot cache', () => {
    const body = hydrateBody();
    assert.match(body, /querySelectorAll\('\[data-craft-request-bot\]'\)/);
    assert.match(body, /panel\.dataset\.craftRequestBot/);
    assert.match(body, /craftingItemsCache\[botId\]/);
    assert.ok(body.indexOf('CraftingRequestPanel.craftables') > 0 || body.indexOf('Panel.craftables') > 0);
});

test('hydrate re-enables the start button once registry items are present', () => {
    const body = hydrateBody();
    assert.match(body, /craft-request-start/);
    assert.match(body, /start\.disabled = false/);
});

test('both bot-card render paths hydrate the craft request panel', () => {
    const dashboard = renderer.slice(renderer.indexOf('function renderDashboard()'), renderer.indexOf('function applyPresentationPreferences()'));
    const modes = renderer.slice(renderer.indexOf('function renderModes()'), renderer.indexOf('function renderModes()') + 400);
    assert.match(dashboard, /hydrateCraftingItems\(\)/);
    assert.match(modes, /hydrateCraftingItems\(\)/);
});

// Regression: the craft request panel replaced ${modeActions}, which removed every
// mode start/pause/resume/restart/stop button from the mode page.
test('bot card still renders the mode control actions next to the request panel', () => {
    const card = renderer.slice(renderer.indexOf('function botCard('), renderer.indexOf('function renderDashboard()'));
    assert.match(card, /\$\{modeActions\}/);
    assert.match(card, /action: 'mode-start'/);
    assert.match(card, /action: 'mode-stop'/);
    assert.match(card, /action: 'mode-pause'/);
    assert.match(card, /action: 'mode-resume'/);
    assert.match(card, /MCbotCraftingRequestPanel\.render\(/);
});

test('panel module owns the placeholder and the renderer never builds option markup', () => {
    assert.match(panel, /Không có vật phẩm chế tạo/);
    assert.doesNotMatch(renderer, /<option value="\$\{esc\(entry\.id\)\}"/);
});

test('clearing a request keeps the item list and the selected item', () => {
    const start = renderer.indexOf("if (action === 'craft-request-clear')");
    assert.ok(start > 0, 'clear action must exist');
    const clear = renderer.slice(start, renderer.indexOf("if (action === 'save-profile')", start));
    assert.match(clear, /itemId: craftingDraft\(bot\)\.itemId/, 'clear keeps the chosen item');
    assert.match(clear, /quantity: ''/, 'clear resets the entered quantity');
    assert.doesNotMatch(clear, /craftingItemsCache\[bot\]/, 'clear must not drop the registry item cache');
});