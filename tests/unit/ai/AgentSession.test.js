'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const AgentSession = require('../../../src/ai/AgentSession');


test('AgentSession executes tool calls and feeds result back before final answer', async () => {
    const requests = [];
    const provider = {
        async complete(request) {
            requests.push(request);
            if (requests.length === 1) {
                return { message: { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'src/a.js' }) } }] }, model: 'local' };
            }
            return { message: { role: 'assistant', content: 'Đã đọc file.' }, model: 'local' };
        }
    };
    const executed = [];
    const tools = { definitions: () => [], execute: async (name, args) => { executed.push([name, args]); return { content: '1: code' }; } };
    const session = new AgentSession({ provider, tools });
    const result = await session.run({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'local', messages: [{ role: 'user', content: 'đọc' }], systemPrompt: 'system' });
    assert.equal(result.content, 'Đã đọc file.');
    assert.deepEqual(executed, [['read_file', { path: 'src/a.js' }]]);
    assert.equal(requests[1].messages.some(message => message.role === 'tool' && message.tool_call_id === 'call-1'), true);
    assert.equal(result.trace[0].success, true);
});


test('AgentSession forces a final answer without tools when tool-round budget is reached', async () => {
    const requests = [];
    const provider = {
        async complete(request) {
            requests.push(request);
            if (requests.length <= 2) {
                return { message: { role: 'assistant', content: '', tool_calls: [{ id: `call-${requests.length}`, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: `src/${requests.length}.js` }) } }] }, model: 'local' };
            }
            assert.deepEqual(request.tools, []);
            return { message: { role: 'assistant', content: 'Tổng hợp từ bằng chứng hiện có.' }, model: 'local' };
        }
    };
    const tools = { definitions: () => [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } }], execute: async () => ({ content: 'code' }) };
    const session = new AgentSession({ provider, tools, maxToolRounds: 2 });
    const result = await session.run({ model: 'local', messages: [{ role: 'user', content: 'kiểm tra' }], systemPrompt: 'system' });
    assert.equal(result.content, 'Tổng hợp từ bằng chứng hiện có.');
    assert.equal(result.finalizedByBudget, true);
    assert.equal(result.finalizeReason, 'tool-round-budget');
    assert.equal(result.toolRounds, 2);
});

test('AgentSession blocks an identical repeated tool call instead of executing it twice', async () => {
    let requestCount = 0;
    let executeCount = 0;
    const provider = {
        async complete(request) {
            requestCount += 1;
            if (requestCount <= 2) {
                return { message: { role: 'assistant', content: '', tool_calls: [{ id: `repeat-${requestCount}`, type: 'function', function: { name: 'search_project', arguments: '{"query":"B5"}' } }] }, model: 'local' };
            }
            return { message: { role: 'assistant', content: 'Đủ bằng chứng.' }, model: 'local' };
        }
    };
    const tools = { definitions: () => [], execute: async () => { executeCount += 1; return { matches: [] }; } };
    const session = new AgentSession({ provider, tools, maxToolRounds: 4 });
    const result = await session.run({ model: 'local', messages: [{ role: 'user', content: 'B5' }], systemPrompt: 'system' });
    assert.equal(result.content, 'Đủ bằng chứng.');
    assert.equal(executeCount, 1);
    assert.equal(result.trace.some(item => item.repeated === true && item.success === false), true);
});
