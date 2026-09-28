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
    for (const page of ['dashboard','bots','modes','builder','incidents','logs','settings','tools','diagnostics']) assert.match(html, new RegExp(`data-page="${page}"`));
    assert.match(router, /overview:'dashboard'/);
    assert.match(app, /MCbotRendererRouter\.apply/);
    assert.match(app, /experienceLevel/);
    assert.match(css, /body\[data-experience="standard"\]/);
});

test('User UI stays Win10-simple: no runtime logic, snapshot-only, clear lifecycle actions', () => {
    // Modes page is a guided flow: bot select -> connect -> mode -> run -> error handling -> stop.
    assert.match(html, /Chọn bot → kết nối → chọn chế độ → chạy → xử lý lỗi → dừng/);
    // Advanced mode tuning collapses behind a DEV-gated <details>, never removed:
    // DOM ids must stay stable so RendererDomContract cannot regress.
    assert.match(html, /user-advanced-config[^>]*data-experience="advanced"/);
    assert.match(html, /Cấu hình chế độ \(nâng cao\)/);
    assert.match(html, /Chế độ tương thích \(nâng cao\)/);
    assert.match(html, /id="modeCards"/);
    assert.match(html, /id="b5Journey"/);
    // Settings page keeps the lifecycle entry points at the top: start/restart/stop.
    assert.match(html, /id="startBackend"/);
    assert.match(html, /id="restartBackend"/);
    assert.match(html, /id="stopBackend"/);
    assert.match(html, /Khởi động, dừng, dữ liệu và tùy chọn chính/);
    // Win10-like flat theme: square corners, no lifted shadows, Segoe UI body font.
    assert.match(css, /--radius:\s*4px/);
    assert.match(css, /--shadow:\s*none/);
    assert.match(css, /"Segoe UI"/);
    // No new backend surface: no extra script modules, no new IPC channels.
    assert.doesNotMatch(html, /features\/user\//);
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
