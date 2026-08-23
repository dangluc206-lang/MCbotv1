'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main } = require('../../../scripts/scaffold-mode');

test('mode scaffold creates a ManagedMode skeleton without overwriting existing files', t => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-mode-scaffold-'));
    t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
    const result = main(['mining', 'Mining'], baseDir);
    assert.equal(result.modeId, 'mining');
    const service = fs.readFileSync(path.join(baseDir, 'src/modes/mining/MiningModeService.js'), 'utf8');
    assert.match(service, /extends ManagedMode/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(baseDir, 'config/modes/mining.json'), 'utf8')), { enabled: false });
    assert.throws(() => main(['mining'], baseDir), /Refusing to overwrite/);
});
