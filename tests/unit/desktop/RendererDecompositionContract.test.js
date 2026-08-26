'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..', '..');

test('XP-200 renderer loads explicit core, component, page and feature boundaries before app', () => {
    const html = fs.readFileSync(path.join(root, 'src/desktop/renderer/index.html'), 'utf8');
    for (const file of ['core/RendererApiClient.js','core/RendererRouter.js','core/KeyedDom.js','components/AccessibleDialog.js','pages/PageCatalog.js','features/b5/B5ViewModel.js','features/incidents/IncidentViewModel.js','features/builder/TypedModuleEditor.js','features/modes/ModeViewModel.js']) assert.match(html, new RegExp(file.replace(/[.]/g,'\\.')));
    assert.ok(html.indexOf('core/RendererRouter.js') < html.indexOf('app.js'));
});

test('XP-301 standard builder is typed and raw JSON is advanced-only', () => {
    const html = fs.readFileSync(path.join(root, 'src/desktop/renderer/index.html'), 'utf8');
    const app = fs.readFileSync(path.join(root, 'src/desktop/renderer/app.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'src/desktop/renderer/styles.css'), 'utf8');
    assert.match(html, /id="moduleSearch"/);
    assert.match(html, /id="dryRunCustomMode"/);
    assert.match(html, /id="customStopSteps"/);
    assert.match(html, /advanced-builder[^>]*><summary>Cấu hình JSON nâng cao/);
    assert.match(app, /MCbotTypedModuleEditor\.read/);
    assert.match(css, /data-experience="standard"[^\n]+advanced-builder/);
    assert.doesNotMatch(app, /storage-protect'\s*:\s*\{[^}]*allowSmelting/);
});
