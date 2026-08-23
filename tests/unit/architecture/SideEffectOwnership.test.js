'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { audit, scanText } = require('../../../scripts/audit-side-effect-ownership');

const root = path.resolve(__dirname, '../../..');

test('WP-004 current repository has no raw side-effect bypass or uncatalogued destructive artifact owner', () => {
    const result = audit({ baseDir: root });
    assert.deepEqual(result.failures, []);
    assert.equal(result.rawSideEffects.every(item => item.violations.length === 0), true);
    assert.equal(result.artifactMutations.length > 10, true);
});

test('WP-004 scanner rejects synthetic raw bypass and uncatalogued filesystem mutation', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-owner-audit-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'bad.js'), "module.exports=(bot,fs)=>{bot.chat('/raw');fs.rmSync('/tmp/x',{force:true});};\n");
    const result = audit({ baseDir: dir, sourceFiles: ['src/bad.js'] });
    assert.ok(result.failures.some(item => item.code === 'RAW_SIDE_EFFECT_BYPASS'));
    assert.ok(result.failures.some(item => item.code === 'ARTIFACT_OWNER_MISSING'));
});

test('WP-004 destructive scanner ignores comments but recognizes write/rename/delete/copy calls', () => {
    const patterns = require('../../../architecture/artifact-ownership.json').destructivePatterns;
    assert.deepEqual(scanText("// fs.rmSync('x')\nfsp.writeFile('x','y'); fsp.rename('a','b'); fsp.cp('a','b');", patterns).sort(), ['copy', 'rename', 'write']);
});
