'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const html = fs.readFileSync(path.join(root, 'src/desktop/renderer/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/desktop/renderer/styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/desktop/renderer/app.js'), 'utf8');
const router = fs.readFileSync(path.join(root, 'src/desktop/renderer/core/RendererRouter.js'), 'utf8');
const dialog = fs.readFileSync(path.join(root, 'src/desktop/renderer/components/AccessibleDialog.js'), 'utf8');

test('XP-100 navigation keeps every product surface reachable under four progressive groups', () => {
    for (const label of ['Vận hành', 'Xây dựng', 'Bảo trì', 'Nâng cao']) assert.match(html, new RegExp(`>${label}<`));
    for (const page of ['dashboard','bots','modes','builder','incidents','logs','settings','tools','diagnostics','ai']) assert.match(html, new RegExp(`data-page="${page}"`));
    assert.match(router, /overview:'dashboard'/);
    assert.match(app, /MCbotRendererRouter\.apply/);
    assert.match(app, /experienceLevel/);
    assert.match(css, /body\[data-experience="standard"\]/);
});

test('XP-101 critical journeys use in-app dialogs, keyboard focus and accessible live regions', () => {
    assert.doesNotMatch(app, /window\.(?:confirm|prompt)\s*\(/);
    assert.match(html, /id="confirmDialog"/);
    assert.match(html, /id="promptDialog"/);
    assert.match(html, /aria-live="polite"/);
    assert.match(dialog, /restoreFocus\?\.focus\?\.\(\)/);
    assert.match(css, /--font-body:\s*14px/);
    assert.match(css, /data-theme="high-contrast"/);
    assert.match(css, /prefers-reduced-motion/);
});

test('XP-102 through XP-108 have renderer-to-preload product reachability', () => {
    for (const symbol of ['readiness','health','incidents','b5Journey','openConfigWorkspace','configBackups','searchPresentation']) assert.match(fs.readFileSync(path.join(root, 'src/desktop/preload.js'), 'utf8'), new RegExp(`${symbol}:`));
    assert.match(html, /id="page-incidents"/);
    assert.match(html, /id="b5Journey"/);
    assert.match(html, /id="backupCatalog"/);
    assert.match(html, /id="commandPaletteDialog"/);
});
