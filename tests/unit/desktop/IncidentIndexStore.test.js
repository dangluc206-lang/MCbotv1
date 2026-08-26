'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const IncidentIndexStore = require('../../../src/desktop/incidents/IncidentIndexStore');

test('IncidentIndexStore correlates repeats, persists lifecycle and rejects stale generation', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-incidents-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    let now = Date.parse('2026-08-25T00:00:00.000Z');
    let sequence = 0;
    const filePath = path.join(directory, 'index.json');
    const store = new IncidentIndexStore({ filePath, now: () => now, idFactory: () => `id-${++sequence}` });
    const failure = {
        botId: 'bot-01', connectionGeneration: 4, code: 'STORAGE_TIMEOUT', operation: 'B5CraftMode', step: 'protect', resource: 'iron',
        occurredAt: new Date(now).toISOString(), message: 'blocked', canonicalError: { severity: 'error', operatorState: 'BLOCKED', safeToRetry: false, allowedActions: ['retry-storage-protection', 'inspect-diagnostic'] }
    };
    const first = await store.ingest(failure, { artifactId: 'runtime-failure:bot-01' });
    now += 1000;
    const repeated = await store.ingest({ ...failure, occurredAt: new Date(now).toISOString() }, { artifactId: 'runtime-failure:bot-01:2' });
    assert.equal(repeated.id, first.id);
    assert.equal(repeated.count, 2);
    assert.equal(repeated.state, 'NEEDS_ACTION');
    await assert.rejects(store.transition(first.id, 'RECOVERING', { expectedGeneration: 3 }), { code: 'DESKTOP_INCIDENT_STALE_GENERATION' });
    await store.transition(first.id, 'RESOLVED', { expectedGeneration: 4, reason: 'verified' });
    await store.transition(first.id, 'ACKNOWLEDGED', { expectedGeneration: 4 });
    await assert.rejects(store.transition(first.id, 'RECOVERING'), { code:'DESKTOP_INCIDENT_TRANSITION_INVALID' });
    await store.drain();
    const reloaded = new IncidentIndexStore({ filePath });
    await reloaded.load();
    assert.equal(reloaded.snapshot()[0].state, 'ACKNOWLEDGED');
    assert.equal(JSON.stringify(reloaded.snapshot()).includes('client'), false);
});

test('IncidentIndexStore opens a new episode after terminal closure or episode window', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-incidents-window-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    let now = 100000;
    let id = 0;
    const store = new IncidentIndexStore({ filePath: path.join(directory, 'index.json'), episodeWindowMs: 1000, now: () => now, idFactory: () => `episode-${++id}` });
    const input = { botId: 'bot-1', code: 'GUI_TIMEOUT', operation: 'Gui', step: 'open', occurredAt: new Date(now).toISOString() };
    const first = await store.ingest(input);
    await store.transition(first.id, 'RESOLVED');
    now += 1;
    const second = await store.ingest({ ...input, occurredAt: new Date(now).toISOString() });
    assert.notEqual(first.id, second.id);
    now += 2000;
    const third = await store.ingest({ ...input, occurredAt: new Date(now).toISOString() });
    assert.notEqual(second.id, third.id);
});

test('QA upgrade: nested diagnostic actions and operator state remain actionable', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-incidents-nested-'));
    t.after(() => fs.rm(directory, { recursive:true, force:true }));
    const store = new IncidentIndexStore({ filePath:path.join(directory, 'index.json'), idFactory:() => 'nested' });
    const incident = await store.ingest({
        botId:'bot-02', operation:'B5CraftMode', diagnostic:{ canonicalError:{ code:'STORAGE_BLOCKED', severity:'error', operatorState:'BLOCKED', safeToRetry:false, allowedActions:['inspect-diagnostic','retry-storage-protection','unknown-action'] } }
    });
    assert.equal(incident.code, 'STORAGE_BLOCKED');
    assert.equal(incident.state, 'NEEDS_ACTION');
    assert.deepEqual(incident.allowedActions.sort(), ['inspect-diagnostic','retry-storage-protection']);
});
