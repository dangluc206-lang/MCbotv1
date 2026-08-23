'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ProjectWorkspace = require('../../../src/ai/knowledge/ProjectWorkspace');

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-ai-workspace-'));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'node_modules', 'hidden'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.2.3' }));
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# rules\n');
    fs.writeFileSync(path.join(root, 'src', 'sample.js'), "const value = 'needle';\nmodule.exports = value;\n");
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=bad\n');
    fs.writeFileSync(path.join(root, 'node_modules', 'hidden', 'x.js'), 'needle');
    return root;
}

test('ProjectWorkspace indexes source but excludes secrets and ignored directories', async () => {
    const root = fixture();
    const workspace = new ProjectWorkspace({ root });
    const info = await workspace.inspect();
    assert.equal(info.version, '1.2.3');
    assert.equal(info.hasAgents, true);
    assert.ok(info.files.includes('src/sample.js'));
    assert.equal(info.files.includes('.env'), false);
    assert.equal(info.files.some(file => file.startsWith('node_modules/')), false);
    const matches = await workspace.search('needle');
    assert.deepEqual(matches.map(item => item.path), ['src/sample.js']);
    fs.rmSync(root, { recursive: true, force: true });
});

test('ProjectWorkspace blocks traversal and environment files while allowing controlled patch', async () => {
    const root = fixture();
    const workspace = new ProjectWorkspace({ root });
    assert.throws(() => workspace.resolve('../outside.txt'), /escapes AI workspace/);
    assert.throws(() => workspace.resolve('.env'), /Secret\/environment/);
    const result = await workspace.replaceText('src/sample.js', { oldText: "'needle'", newText: "'changed'" });
    assert.equal(result.replacements, 1);
    assert.match(fs.readFileSync(path.join(root, 'src', 'sample.js'), 'utf8'), /changed/);
    fs.rmSync(root, { recursive: true, force: true });
});


test('ProjectWorkspace rejects symlink escape for existing and new targets', async t => {
    if (process.platform === 'win32') return t.skip('Symlink creation may require Windows developer/admin privileges.');
    const root = fixture();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-ai-outside-'));
    fs.writeFileSync(path.join(outside, 'outside.js'), 'module.exports = 9;\n');
    fs.symlinkSync(outside, path.join(root, 'src', 'escape'), 'dir');
    const workspace = new ProjectWorkspace({ root });
    assert.throws(() => workspace.resolve('src/escape/outside.js'), /resolves outside AI workspace/);
    assert.throws(() => workspace.resolve('src/escape/new.js', { allowMissing: true }), /resolves outside AI workspace/);
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
});

test('ProjectWorkspace exposes atomic temp cleanup warning while preserving the committed edit', async () => {
    const root = fixture();
    const removePath = async () => {
        const error = new Error('simulated cleanup denial');
        error.code = 'EACCES';
        throw error;
    };
    const workspace = new ProjectWorkspace({ root, removePath });
    const result = await workspace.replaceText('src/sample.js', { oldText: "'needle'", newText: "'changed'" });
    assert.equal(result.replacements, 1);
    assert.equal(result.cleanupWarning.operation, 'ai-workspace-temp-cleanup');
    assert.equal(result.cleanupWarning.code, 'EACCES');
    assert.match(result.cleanupWarning.target, /^\.mcbot-ai-.*\.tmp$/);
    assert.equal(Object.isFrozen(result.cleanupWarning), true);
    assert.equal(workspace.lastCleanupWarning, result.cleanupWarning);
    assert.match(fs.readFileSync(path.join(root, 'src', 'sample.js'), 'utf8'), /changed/);
    fs.rmSync(root, { recursive: true, force: true });
});

test('ProjectWorkspace cleanup failure never masks the primary atomic-write failure', async () => {
    const root = fixture();
    fs.mkdirSync(path.join(root, 'src', 'blocked.js'));
    const removePath = async () => {
        const error = new Error('simulated cleanup denial');
        error.code = 'EACCES';
        throw error;
    };
    const workspace = new ProjectWorkspace({ root, removePath });
    await assert.rejects(() => workspace.writeFile('src/blocked.js', 'new content'), error => error?.code !== 'EACCES');
    assert.equal(workspace.lastCleanupWarning?.code, 'EACCES');
    fs.rmSync(root, { recursive: true, force: true });
});
