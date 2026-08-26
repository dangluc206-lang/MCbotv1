'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ModeConfigurationUseCases = require('../../../src/desktop/use-cases/ModeConfigurationUseCases');

test('ModeConfigurationUseCases preserves editor ownership and sanitizes output', async () => {
    const calls = [];
    class CollectorEditor {
        constructor(options) { calls.push(['collector-constructor', options]); }
        async read() { calls.push(['collector-read']); return { password: 'hidden', value: 1 }; }
        async update(fields) { calls.push(['collector-update', fields]); return { token: 'hidden', fields }; }
    }
    class FishingEditor {
        constructor(options) { calls.push(['fishing-constructor', options]); }
        async read(botId) { calls.push(['fishing-read', botId]); return { botId, authorization: 'hidden' }; }
        async setAreaPosition(fields) { calls.push(['fishing-update', fields]); return fields; }
    }
    let runningChecks = 0;
    const bundle = {
        configuration: {},
        shared: {
            botRegistry: {},
            configMutations: {},
            loggerFactory: { create(scope) { return { scope }; } }
        }
    };
    const useCases = new ModeConfigurationUseCases({
        baseDir: 'C:/runtime',
        bundleProvider: () => bundle,
        requireRunning: () => { runningChecks += 1; },
        CollectorEditorClass: CollectorEditor,
        FishingEditorClass: FishingEditor
    });

    assert.deepEqual(await useCases.collector('bot-01'), { password: '[REDACTED]', value: 1 });
    assert.deepEqual(await useCases.updateCollector('bot-01', { enabled: true }), { token: '[REDACTED]', fields: { enabled: true } });
    assert.deepEqual(await useCases.fishing('bot-02'), { botId: 'bot-02', authorization: '[REDACTED]' });
    assert.deepEqual(await useCases.updateFishingArea('bot-02', { x: 1, y: 2, z: 3 }), { botId: 'bot-02', x: 1, y: 2, z: 3 });
    assert.equal(runningChecks, 4);
    assert.equal(calls.filter(entry => entry[0] === 'collector-constructor').every(entry => entry[1].botId === 'bot-01'), true);
    assert.equal(calls.some(entry => entry[0] === 'fishing-update' && entry[1].botId === 'bot-02'), true);
});

