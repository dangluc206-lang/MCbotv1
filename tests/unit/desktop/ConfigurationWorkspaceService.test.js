'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ConfigurationWorkspaceService = require('../../../src/desktop/configuration/ConfigurationWorkspaceService');

test('ConfigurationWorkspaceService previews semantic impact, saves and undoes', async () => {
    let current = { enabled: true, pollIntervalMs: 1000 };
    const service = new ConfigurationWorkspaceService({
        idFactory: () => '1',
        loadGroup: async key => ({ key, file: 'config/modes/b5-craft.json', schema: 'b5CraftMode', value: structuredClone(current) }),
        validateGroup: async (_key, value) => ({ valid: value.pollIntervalMs >= 500, errors: value.pollIntervalMs >= 500 ? [] : ['poll too low'] }),
        saveGroup: async (_key, value) => { current = structuredClone(value); return { backup: 'backup.json' }; }
    });
    const opened = await service.open('b5CraftMode');
    const draft = { enabled: true, pollIntervalMs: 1500 };
    const preview = await service.preview(opened.sessionId, draft);
    assert.equal(preview.dirty, true);
    assert.equal(preview.impact, 'LIVE_RECONFIGURE');
    assert.deepEqual(preview.changes.map(change => change.path), ['pollIntervalMs']);
    const saved = await service.save(opened.sessionId, draft, { expectedRevision: opened.revision });
    assert.equal(saved.saved, true);
    assert.equal(current.pollIntervalMs, 1500);
    await service.undo(opened.sessionId);
    assert.equal(current.pollIntervalMs, 1000);
});

test('ConfigurationWorkspaceService rejects invalid draft and external conflict', async () => {
    let current = { value: 1 };
    const service = new ConfigurationWorkspaceService({
        loadGroup: async key => ({ key, value: structuredClone(current) }),
        validateGroup: async (_key, value) => ({ valid: value.value >= 0, errors: ['negative'] }),
        saveGroup: async () => { throw new Error('must not save'); }
    });
    const opened = await service.open('app');
    await assert.rejects(service.save(opened.sessionId, { value: -1 }, { expectedRevision: opened.revision }), { code: 'CONFIG_WORKSPACE_INVALID' });
    current = { value: 2 };
    await assert.rejects(service.save(opened.sessionId, { value: 3 }, { expectedRevision: opened.revision }), { code: 'CONFIG_WORKSPACE_EXTERNAL_CONFLICT' });
});
