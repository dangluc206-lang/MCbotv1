'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const DesktopReadinessService = require('../../../src/desktop/readiness/DesktopReadinessService');

test('DesktopReadinessService is read-only and distinguishes setup from blockers', async () => {
    let accessCalls = 0;
    const controller = { lifecycle: 'RUNNING', async listProfiles() { return [{ id: 'bot-01', enabled: true }]; } };
    const service = new DesktopReadinessService({
        baseDir: 'C:/runtime',
        controllerProvider: () => controller,
        secretStoreProvider: () => ({ status: () => ({ state: 'READY', keys: ['bot.bot-01.password'] }) }),
        versionProvider: () => '2.7.0',
        runtimeProvenanceProvider: async () => ({ status: 'READY', parity: 'RUNTIME_CUSTOMIZED', summary: 'runtime customized', connectionRelevant: { paths: ['server.json'] } }),
        fsImpl: { async access() { accessCalls += 1; } }
    });
    const result = await service.sample();
    assert.equal(result.contract, 'desktop-readiness-v1');
    assert.equal(result.overall, 'READY');
    assert.equal(result.sideEffects, 'NONE');
    assert.equal(accessCalls, 1);
    assert.equal(result.checks.some(entry => entry.id === 'enabled-bot' && entry.ready), true);
    assert.equal(result.checks.some(entry => entry.id === 'runtime-config-source' && entry.ready), true);
    assert.match(result.checks.find(entry => entry.id === 'runtime-config-source').remediation, /server\.json/);
});

test('DesktopReadinessService reports config root and boot failures without connecting', async () => {
    const controller = { lifecycle: 'FAILED', bootFailure: { category: 'CONFIG', operatorSummary: 'bad config' } };
    const service = new DesktopReadinessService({
        baseDir: 'C:/runtime', controllerProvider: () => controller, versionProvider: () => '2.7.0',
        secretStoreProvider: () => ({ status: () => ({ state: 'UNAVAILABLE', remediation: 'OS encryption unavailable' }) }),
        runtimeProvenanceProvider: async () => ({ status: 'BLOCKED', summary: 'runtime incomplete' }),
        fsImpl: { async access() { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } }
    });
    const result = await service.sample();
    assert.equal(result.overall, 'BLOCKED');
    assert.equal(result.checks.filter(entry => entry.status === 'BLOCKED').length >= 3, true);
});
