'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AiToolRegistry = require('../../../src/ai/tools/AiToolRegistry');

function rootFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-ai-tools-'));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.0.0"}\n');
    fs.writeFileSync(path.join(root, 'src', 'a.js'), 'module.exports = 1;\n');
    return root;
}

test('AiToolRegistry permission levels expose mutation/test/runtime tools progressively', () => {
    const root = rootFixture();
    const names = permission => new AiToolRegistry({ workspaceRoot: root, permission }).definitions().map(item => item.function.name);
    assert.equal(names('READ').includes('apply_patch'), false);
    assert.equal(names('PATCH').includes('apply_patch'), true);
    assert.equal(names('PATCH').includes('run_check'), false);
    assert.equal(names('DEVELOP').includes('run_check'), true);
    assert.equal(names('ADMIN').includes('control_bot'), true);
    fs.rmSync(root, { recursive: true, force: true });
});

test('AiToolRegistry denies mutation under READ and routes ADMIN controls through DesktopController', async () => {
    const root = rootFixture();
    const readOnly = new AiToolRegistry({ workspaceRoot: root, permission: 'READ' });
    await assert.rejects(() => readOnly.execute('apply_patch', { path: 'src/a.js', oldText: '1', newText: '2' }), /requires Local AI permission PATCH/);
    const calls = [];
    const controller = { connect: async botId => { calls.push(['connect', botId]); return { success: true }; } };
    const admin = new AiToolRegistry({ workspaceRoot: root, permission: 'ADMIN', controller });
    await admin.execute('control_bot', { action: 'connect', botId: 'bot-01' });
    assert.deepEqual(calls, [['connect', 'bot-01']]);
    fs.rmSync(root, { recursive: true, force: true });
});
