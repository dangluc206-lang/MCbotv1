'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const OllamaProvider = require('../../../src/ai/providers/OllamaProvider');

function response(payload, status = 200) {
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) };
}

test('OllamaProvider accepts only loopback OpenAI-compatible endpoints', () => {
    assert.equal(OllamaProvider.normalizeBaseUrl('http://127.0.0.1:11434/v1/'), 'http://127.0.0.1:11434/v1');
    assert.equal(OllamaProvider.normalizeBaseUrl('http://localhost:11434'), 'http://localhost:11434/v1');
    assert.throws(() => OllamaProvider.normalizeBaseUrl('https://example.com/v1'), /localhost/);
});

test('OllamaProvider lists models and sends tool-capable chat requests', async () => {
    const calls = [];
    const provider = new OllamaProvider({ fetchImpl: async (url, init) => {
        calls.push({ url, init });
        if (url.endsWith('/models')) return response({ data: [{ id: 'qwen3:8b', owned_by: 'library' }] });
        return response({ choices: [{ message: { role: 'assistant', content: 'ok' } }], model: 'qwen3:8b' });
    }});
    const models = await provider.listModels({ baseUrl: 'http://127.0.0.1:11434/v1' });
    assert.deepEqual(models.map(item => item.id), ['qwen3:8b']);
    const result = await provider.complete({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b', messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function', function: { name: 'x', parameters: { type: 'object' } } }] });
    assert.equal(result.message.content, 'ok');
    const body = JSON.parse(calls[1].init.body);
    assert.equal(body.tool_choice, 'auto');
    assert.equal(body.tools[0].function.name, 'x');
});
