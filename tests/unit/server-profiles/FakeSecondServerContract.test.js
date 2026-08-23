'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const EventBus = require('../../../src/core/EventBus');
const ServerProfile = require('../../../src/server-profiles/ServerProfile');
const ServerProfileRegistry = require('../../../src/server-profiles/ServerProfileRegistry');
const CommandRegistry = require('../../../src/commands/CommandRegistry');
const CommandResolver = require('../../../src/commands/CommandResolver');
const CommandService = require('../../../src/commands/CommandService');
const SkyblockJoinOperation = require('../../../src/server-features/skyblock/SkyblockJoinOperation');
const B5TraceRecorder = require('../../../src/server-features/crafting/b5/trace/B5TraceRecorder');
const fixture = require('../../fixtures/server-profiles/fake-second-server');

function fakeProfile() { return new ServerProfile(fixture); }

test('WP-105 fake second server exercises public semantic command/profile boundary and unsupported capability fails closed', async () => {
    const profile = fakeProfile();
    const sent = [];
    const service = new CommandService({ botId: 'fake-bot', resolver: new CommandResolver({ registry: new CommandRegistry(profile.requireCatalog('commands')) }), executor: { async execute(command) { sent.push(command); return { command }; } } });
    assert.equal((await service.send('storage', { confirm: false })).success, true);
    assert.deepEqual(sent, ['/vault open']);
    assert.equal(profile.requireCatalog('recipes').fake_refined.inputs.raw_fake, 8);
    assert.equal(profile.requireCatalog('storage').capacityIndicator.fallbackLimit, 123456);
    assert.equal(profile.requireCatalog('serverTimings').postB5CooldownMs, 42000);
    assert.throws(() => profile.requireCapability('personalVault'), error => error.code === 'SERVER_PROFILE_NOT_READY');
});

test('WP-105 same generic SkyblockJoinOperation executes fake join flow with different command and slots', async () => {
    const profile = fakeProfile(); const config = profile.requireBinding('join'); const eventBus = new EventBus(); const clicks = []; let session = null; let seq = 0;
    const context = { has: () => true, getGeneration: () => 1, get: () => ({ entity: { position: { x: 0, y: 64, z: 0 } } }) };
    const open = (definitionId, slot) => { const slots = Array(18).fill(null); slots[slot] = { name: 'paper' }; session = { id: `s${++seq}`, definitionId, connectionGeneration: 1, window: { slots } }; eventBus.emit('gui:opened', { botId: 'fake-bot', connectionGeneration: 1, sessionId: session.id, definitionId }); };
    const operation = new SkyblockJoinOperation({ botId: 'fake-bot', context, eventBus, config,
        commandService: { async send(key) { assert.equal(key, 'skyblock'); queueMicrotask(() => open('realmPicker', 3)); return { success: true }; } },
        guiManager: { current: () => session, async click(slot) { clicks.push(slot); if (slot === 3) queueMicrotask(() => open('realmConfirm', 8)); if (slot === 8) queueMicrotask(() => eventBus.emit('movement:teleport', { botId: 'fake-bot', connectionGeneration: 1, position: { x: 20, y: 70, z: 20 } })); await new Promise(resolve => setImmediate(resolve)); return { slot }; } }
    });
    const result = await operation.execute('alpha', { expectedGeneration: 1 });
    assert.deepEqual(clicks, [3, 8]);
    assert.equal(result.verified, 'movement:teleport');
});

test('WP-105 mixed profiles isolate immutable knowledge and capture revision in trace', () => {
    const fake = fakeProfile();
    const miner = new ServerProfile({ id: 'miner', revision: 'r-miner', endpoint: { host: 'mc.minerua.com' }, catalogs: { commands: { storage: '/kho' } }, capabilities: { storage: true } });
    const registry = new ServerProfileRegistry(); registry.register(miner); registry.register(fake); registry.seal();
    assert.equal(registry.require('miner').requireCatalog('commands').storage, '/kho');
    assert.equal(registry.require('fake-second').requireCatalog('commands').storage, '/vault open');
    assert.notEqual(registry.require('miner').catalogs, registry.require('fake-second').catalogs);
    const trace = new B5TraceRecorder({ botId: 'fake-bot', serverProfile: fake }).recordResult({ success: true, status: 'SUCCESS', data: {} });
    assert.equal(trace.serverProfileRevision, fixture.revision);
});

test('WP-105 designated generic modules contain no profile-id MinerUA branch', () => {
    const roots = ['src/core','src/modes','src/gui','src/items','src/planning','src/commands','src/operations','src/server-features'];
    const files = [];
    const walk = dir => { for (const entry of fs.readdirSync(dir,{withFileTypes:true})) { const full=path.join(dir,entry.name); if(entry.isDirectory()) walk(full); else if(entry.name.endsWith('.js')) files.push(full); } };
    roots.forEach(walk);
    const offenders = files.filter(file => /(?:profileId|serverProfile)\s*={0,3}\s*['\"]?minerua|minerua['\"]?\s*={0,3}\s*(?:profileId|serverProfile)/i.test(fs.readFileSync(file,'utf8')));
    assert.deepEqual(offenders, []);
});
