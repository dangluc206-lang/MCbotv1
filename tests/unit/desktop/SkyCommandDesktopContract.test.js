'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const renderer = fs.readFileSync(path.join(ROOT, 'src/desktop/renderer/app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'src/desktop/renderer/index.html'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'src/desktop/preload.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'src/desktop/main.js'), 'utf8');

test('desktop exposes scoped Sky command registration, deletion and send controls', () => {
    for (const id of ['skyCommandSky','skyCommandBot','skyCommandId','skyCommandValue','skyCommandList','saveSkyCommand']) {
        assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(preload, /skyCommands:\s*\(\)\s*=>\s*invoke\('mcbot:sky-commands:get'\)/);
    assert.match(preload, /saveSkyCommand:/);
    assert.match(preload, /deleteSkyCommand:/);
    assert.match(preload, /sendSkyCommand:/);
    assert.match(main, /mcbot:sky-commands:save/);
    assert.match(main, /mcbot:sky-commands:delete/);
    assert.match(main, /mcbot:sky-commands:send/);
    assert.match(renderer, /Lệnh riêng theo Sky/);
});

test('GUI inspector excludes scoped Sky commands while command center can show them', () => {
    assert.match(renderer, /filter\(command => command\.scope !== 'sky'\)/);
    assert.match(renderer, /command\.scope === 'sky'/);
});
