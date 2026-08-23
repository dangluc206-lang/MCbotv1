'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../../../src/desktop/renderer/app.js'), 'utf8');

test('renderer action failures are reported centrally before terminal UI catches absorb the rejected promise', () => {
    assert.match(source, /reportRendererError\(error, key \? `action:\$\{key\}` : 'action'\)/);
    assert.match(source, /request\.catch\(reportError => console\.error/);
    assert.doesNotMatch(source, /reportRendererError\?\.\([^\n]+\)\.catch\(\(\) => \{\}\)/);
});

test('renderer startup diagnostics do not silently discard logs, app-info or AI auto-refresh failures', () => {
    assert.match(source, /catch \(error\) \{ reportRendererError\(error, 'initial-log-load'\); \}/);
    assert.match(source, /catch\(error => reportRendererError\(error, 'app-info-load'\)\)/);
    assert.match(source, /catch\(error => reportRendererError\(error, 'ai-workspace-auto-inspect'\)\)/);
    assert.match(source, /catch\(error => reportRendererError\(error, 'ai-model-auto-refresh'\)\)/);
});
