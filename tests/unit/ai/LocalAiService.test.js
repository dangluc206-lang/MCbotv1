'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const LocalAiService = require('../../../src/ai/LocalAiService');

function makeWorkspace() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-ai-service-'));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'mcbot-test', version: '2.7.0' }));
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# AGENTS\nAlways inspect code.\n');
    fs.writeFileSync(path.join(root, 'RULES.md'), '# RULES\nNo blind retry.\n');
    fs.writeFileSync(path.join(root, 'src', 'feature.js'), "module.exports = 'B5';\n");
    return root;
}

test('LocalAiService grounds agent in workspace docs and exposes read tools', async () => {
    const root = makeWorkspace();
    const requests = [];
    const provider = {
        async listModels() { return [{ id: 'local-model' }]; },
        async complete(request) {
            requests.push(request);
            if (requests.length === 1) {
                return { model: 'local-model', message: { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'search_project', arguments: '{"query":"B5"}' } }] } };
            }
            return { model: 'local-model', message: { role: 'assistant', content: 'Đã kiểm tra source.' } };
        }
    };
    const service = new LocalAiService({ provider });
    const result = await service.runAgent({ workspaceRoot: root, baseUrl: 'http://127.0.0.1:11434/v1', model: 'local-model', permission: 'READ', prompt: 'kiểm tra B5' });
    assert.equal(result.content, 'Đã kiểm tra source.');
    assert.equal(result.workspace.version, '2.7.0');
    assert.equal(result.trace[0].name, 'search_project');
    assert.match(requests[0].messages[0].content, /Always inspect code/);
    assert.match(requests[0].messages[0].content, /No blind retry/);
    assert.equal(requests[0].tools.some(item => item.function.name === 'apply_patch'), false);
    fs.rmSync(root, { recursive: true, force: true });
});
