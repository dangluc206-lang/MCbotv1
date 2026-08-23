'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..', '..');
const html = fs.readFileSync(path.join(root, 'src', 'desktop', 'renderer', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'desktop', 'renderer', 'app.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src', 'desktop', 'preload.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src', 'desktop', 'main.js'), 'utf8');

test('Desktop exposes Local AI page, IPC and permission selector', () => {
    assert.match(html, /data-page="ai"/);
    assert.match(html, /id="aiPermission"/);
    for (const permission of ['READ', 'PATCH', 'DEVELOP', 'ADMIN']) assert.match(html, new RegExp(`value="${permission}"`));
    assert.match(preload, /aiChat: request => invoke\('mcbot:ai:chat'/);
    assert.match(main, /safeHandle\('mcbot:ai:chat'/);
    assert.match(renderer, /sendAiPrompt/);
    assert.match(renderer, /inspectAiWorkspace/);
});
