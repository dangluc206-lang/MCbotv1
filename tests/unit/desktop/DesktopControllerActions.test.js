'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const DesktopController = require('../../../src/desktop/DesktopController');
const BotContext = require('../../../src/bot/BotContext');

function ok(status, data = null) {
    return { success: true, status, data };
}

function createRunningController() {
    const calls = [];
    const runtime = {
        botId: 'bot-01',
        context: { getGeneration: () => 7, has: () => true },
        getService(name) {
            if (name === 'b5CraftMode') return {
                requestStorageProtectionRetry(request) {
                    calls.push(['b5-retry', request]);
                    return ok('SUCCESS', { accepted: true });
                }
            };
            return null;
        },
        requireService(name) {
            if (name === 'commandService') return { send: async (key, options) => { calls.push(['command', key, options]); return ok('SUCCESS', { key }); } };
            if (name === 'serverFeatureFacade') return { island: () => ({ goHome: async () => ok('SUCCESS') }) };
            throw new Error(`unexpected service ${name}`);
        }
    };
    const controller = new DesktopController({ baseDir: process.cwd() });
    controller.lifecycle = 'RUNNING';
    controller.bundle = {
        fleetControl: {
            profileSnapshot: () => ({ 'bot-01': { enabled: true }, 'bot-02': { enabled: false } }),
            emergencyStop: async (botIds, options) => {
                calls.push(['emergency', [...botIds], options]);
                return { contract: 'fleet-emergency-stop-v1', transactionId: options.idempotencyKey, outcome: 'SUCCESS', botCount: botIds.length, terminalCount: botIds.length, results: botIds.map(botId => ({ botId, status: 'SUCCESS', terminal: true })) };
            },
            requestConnection: async (botId, desired, options) => { calls.push(['connection', botId, desired, options]); return ok('SUCCESS'); },
            requestMode: async (botId, mode, options) => { calls.push(['mode', botId, mode, options]); return ok('SUCCESS'); },
            requestModeState: async (botId, state, options) => { calls.push(['mode-state', botId, state, options]); return ok('SUCCESS'); },
            intent: botId => botId === 'bot-01' ? { desiredMode: 'collector-b5' } : null,
            restartMode: async (botId, mode, options) => { calls.push(['mode-restart', botId, mode, options]); return ok('SUCCESS'); }
        },
        configuration: { registry: { require: name => name === 'commands' ? { home: '/is', login: '/login' } : {} } },
        botProfileAdmin: {
            createProfile: async fields => { calls.push(['profile-create', fields]); return { ...fields, enabled: false }; },
            cloneProfile: async (botId, newId) => { calls.push(['profile-clone', botId, newId]); return { id: newId, enabled: false }; },
            deleteProfile: async botId => { calls.push(['profile-delete', botId]); return { id: botId, deleted: true }; },
            updateProfile: async (botId, fields) => { calls.push(['profile-update', botId, fields]); return { id: botId, ...fields }; }
        },
        application: { getRuntime: botId => { assert.equal(botId, 'bot-01'); return runtime; } }
    };
    return { controller, calls };
}

test('DesktopController fleet actions target enabled profiles and delegate emergency stop transaction', async () => {
    const { controller, calls } = createRunningController();
    const connected = await controller.fleetAction('connect-all');
    assert.equal(connected.success, true);
    assert.deepEqual(calls[0].slice(0, 3), ['connection', 'bot-01', 'CONNECTED']);
    assert.equal(calls.some(call => call.includes('bot-02')), false);

    calls.length = 0;
    const emergency = await controller.fleetAction('emergency-stop');
    assert.equal(emergency.success, true);
    assert.equal(emergency.outcome, 'SUCCESS');
    assert.equal(calls[0][0], 'emergency');
    assert.deepEqual(calls[0][1], ['bot-01']);
    assert.match(calls[0][2].idempotencyKey, /^desktop:/);
});

test('DesktopController sends only registered non-login commands with captured generation', async () => {
    const { controller, calls } = createRunningController();
    const result = await controller.sendRegisteredCommand('bot-01', { commandKey: 'home', confirm: true, timeoutMs: 99999 });
    assert.equal(result.success, true);
    assert.equal(calls[0][0], 'command');
    assert.equal(calls[0][1], 'home');
    assert.equal(calls[0][2].expectedGeneration, 7);
    assert.equal(calls[0][2].timeoutMs, 30000);
    await assert.rejects(() => controller.sendRegisteredCommand('bot-01', { commandKey: 'login' }), /restricted/);
    await assert.rejects(() => controller.sendRegisteredCommand('bot-01', { commandKey: 'missing' }), /restricted/);
});



test('DesktopController restarts the durable primary mode instead of guessing from transient UI state', async () => {
    const { controller, calls } = createRunningController();
    const result = await controller.restartMode('bot-01');
    assert.equal(result.success, true);
    assert.deepEqual(calls[0].slice(0, 3), ['mode-restart', 'bot-01', 'collector-b5']);
});

test('DesktopController routes guarded B5 recovery through the mode use case without raw side effects', async () => {
    const { controller, calls } = createRunningController();
    const result = await controller.retryB5StorageProtection('bot-01', {
        expectedGeneration: 7,
        episodeId: 'episode-1',
        incidentId: 'incident-1',
        idempotencyKey: 'desktop-request-1'
    });
    assert.equal(result.success, true);
    assert.deepEqual(calls[0], ['b5-retry', {
        expectedBotId: 'bot-01', expectedGeneration: 7, episodeId: 'episode-1',
        incidentId: 'incident-1', idempotencyKey: 'desktop-request-1', reason: 'desktop-operator'
    }]);
});

test('DesktopController snapshot separates client online presence from connection phase', () => {
    const controller = new DesktopController({ baseDir: process.cwd() });
    const context = new BotContext('bot-01');
    const client = { username: 'Worker', inventory: { items: () => [], slots: [] } };
    context.attach(client);
    let state = { connectionState: 'AUTHENTICATING', lastError: null };
    const runtime = {
        botId: 'bot-01', context,
        getState: () => state,
        getService: () => null
    };
    controller.lifecycle = 'RUNNING';
    controller.bundle = {
        fleetControl: {
            profileSnapshot: () => ({ 'bot-01': { id: 'bot-01', displayName: 'Worker', username: 'Worker', enabled: true } }),
            intent: () => ({ desiredConnection: 'CONNECTED' })
        },
        application: { listRuntimes: () => [runtime], getState: () => 'RUNNING' }
    };

    const online = controller.snapshot().bots[0];
    assert.equal(online.connectionOnline, true);
    assert.equal(online.state.connectionState, 'AUTHENTICATING');

    context.detach(client);
    state = { connectionState: 'DISCONNECTED', lastError: null };
    const offline = controller.snapshot().bots[0];
    assert.equal(offline.connectionOnline, false);
    assert.equal(offline.state.connectionState, 'DISCONNECTED');
});
test('DesktopController backupConfig creates a manifested catalog copy without mutating source', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-desktop-backup-'));
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config', 'sample.json'), '{"ok":true}\n');
    const controller = new DesktopController({ baseDir: dir });
    const result = await controller.backupConfig();
    assert.equal(fs.existsSync(path.join(result.path, 'files', 'sample.json')), true);
    assert.equal(result.manifest.contract, 'mcbot-config-backup-v1');
    assert.equal(result.manifest.files[0].path, 'sample.json');
    assert.equal(fs.readFileSync(path.join(dir, 'config', 'sample.json'), 'utf8'), '{"ok":true}\n');
    fs.rmSync(dir, { recursive: true, force: true });
});


test('DesktopController creates and clones profiles through the validated profile admin boundary', async () => {
    const { controller, calls } = createRunningController();
    const created = await controller.createProfile({
        id: 'bot-03',
        displayName: 'Worker 03',
        username: 'worker03',
        auth: 'offline',
        version: '1.21.1',
        serverProfile: 'default',
        ignored: 'must-not-cross-boundary'
    });
    assert.equal(created.id, 'bot-03');
    assert.equal(calls[0][0], 'profile-create');
    assert.equal(calls[0][1].ignored, undefined);

    const cloned = await controller.cloneProfile('bot-01', 'bot-01-copy');
    assert.equal(cloned.id, 'bot-01-copy');
    assert.deepEqual(calls[1], ['profile-clone', 'bot-01', 'bot-01-copy']);

    const deleted = await controller.deleteProfile('bot-01-copy');
    assert.equal(deleted.deleted, true);
    assert.deepEqual(calls[2], ['profile-delete', 'bot-01-copy']);
});


test('DesktopController records renderer failures through the redacted desktop log channel', () => {
    const controller = new DesktopController({ baseDir: process.cwd() });
    const result = controller.reportRendererError({ message: 'renderer boom', stack: 'secret stack', source: 'test' });
    assert.equal(result.success, true);
    const latest = controller.logSnapshot({ limit: 1 })[0];
    assert.equal(latest.level, 'error');
    assert.equal(latest.scope, 'DesktopRenderer');
    assert.equal(latest.message, 'renderer boom');
    assert.equal(latest.meta.source, 'test');
});

test('DesktopController exposes safe module catalog without starting Minecraft backend', () => {
    const controller = new DesktopController({ baseDir: process.cwd() });
    const modules = controller.customModeModules();
    const types = modules.map(entry => entry.type);
    for (const type of ['command','sky-command','slash-command','gui-click','wait','move','look','wait-gui','home','sky-join','read-storage','storage-protect','b5-cycle','if','repeat']) {
        assert.ok(types.includes(type), type);
    }
    assert.equal(types.includes('javascript'), false);
    assert.equal(types.includes('raw-chat'), false);
});

test('DesktopController.customModeModules() returns IPC-safe DTO without executor functions', () => {
    const controller = new DesktopController({ baseDir: process.cwd() });
    const modules = controller.customModeModules();

    // Verify 17 modules are present
    assert.equal(modules.length, 17, 'must have exactly 17 module types');

    // Verify no executor function leaked into DTO
    const hasExecutorFunction = modules.some(
        module => typeof module.executor === 'function' || typeof module.executor?.execute === 'function'
    );
    assert.equal(hasExecutorFunction, false, 'must not contain executor function');

    // Verify each module is JSON-serializable (IPC-safe)
    for (const module of modules) {
        try {
            const serialized = JSON.stringify(module);
            const deserialized = JSON.parse(serialized);
            assert.ok(deserialized.type, `module must have type: ${module.type}`);
            assert.ok(deserialized.label, `module must have label: ${module.type}`);
            assert.equal(typeof deserialized.executor, 'undefined', `module must not have executor: ${module.type}`);
        } catch (err) {
            throw new Error(`Module ${module.type} is not JSON-serializable: ${err.message}`);
        }
    }

    // Verify expected metadata fields are preserved
    const commandModule = modules.find(m => m.type === 'command');
    assert.ok(commandModule, 'command module must exist');
    assert.equal(commandModule.label, 'Lệnh hệ thống đã đăng ký');
    assert.equal(commandModule.capability, 'commands');
    assert.equal(commandModule.outputType, 'command-result');
    assert.ok(Array.isArray(commandModule.transientResources));
    assert.ok(Array.isArray(commandModule.serverProfiles));
    assert.equal(commandModule.cancellable, true);
});

test('DesktopController updates mode-driven Sky gateway timing without restoring autoJoin/maxAttempts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-desktop-config-'));
    const target = path.join(dir, 'config', 'skyblock', 'join.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const current = {
        commandKey: 'skyblock', entryGuiId: 'skyServerSelect', joinGuiId: null,
        selections: { sky1: { slot: 11 }, sky2: { slot: 13 } }, defaultSelection: 'sky1', joinSlot: 19,
        guiTimeoutMs: 5000, clickTimeoutMs: 3000, slotReadyTimeoutMs: 5000,
        selectionSettleMs: 300, joinSettleMs: 500, postJoinTimeoutMs: 7000,
        postJoinMinPositionDelta: 4,
        modeJoin: { delayMs: 1200, spawnFallbackDelayMs: 5000, retryDelayMs: 300000, rejoinDelayMs: 300000, recoveryPollMs: 10000, waitForResourcePack: false }
    };
    fs.writeFileSync(target, `${JSON.stringify(current, null, 2)}\n`);
    const applied = [];
    let snapshot = { skyblock: current };
    const controller = new DesktopController({ baseDir: dir });
    controller.lifecycle = 'RUNNING';
    controller.bundle = {
        fleetControl: { profileSnapshot: () => ({}) },
        configuration: {
            registry: { require: key => snapshot[key], get: key => snapshot[key], snapshot: () => snapshot },
            validator: { assertValid(schema, value) { assert.equal(schema, 'skyblock'); assert.equal(value.modeJoin.delayMs, 1500); assert.equal(value.autoJoin, undefined); } },
            crossValidator: { assertValid(candidate) { assert.equal(candidate.skyblock.modeJoin.delayMs, 1500); assert.equal(candidate.skyblock.modeJoin.maxAttempts, undefined); } },
            service: { async reload(key) { snapshot = { ...snapshot, [key]: JSON.parse(fs.readFileSync(target, 'utf8')) }; return { success: true }; } }
        },
        application: { listRuntimes: () => [{ getService: name => name === 'skyblockAutoJoin' ? { status: () => ({ defaultTarget: 'sky1' }), reconfigure: config => applied.push(config) } : null }] }
    };
    const result = await controller.updateSkyAutoJoinConfig({ maxAttempts: 5, enabled: false, delayMs: 1500 });
    assert.equal(result.appliedLive, true);
    assert.equal(result.restartRequired, false);
    assert.equal(applied[0].delayMs, 1500);
    assert.equal(applied[0].maxAttempts, undefined);
    const saved = JSON.parse(fs.readFileSync(target, 'utf8'));
    assert.equal(saved.modeJoin.delayMs, 1500);
    assert.equal(saved.autoJoin, undefined);
    const backups = fs.readdirSync(path.join(dir, 'data', 'backups', 'config-editor'));
    assert.equal(backups.length, 1);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('DesktopController storage protection persists reserve plus Collector-only decompression headroom', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-desktop-storage-config-'));
    const storageFile = path.join(dir, 'config', 'storage', 'kho.json');
    const collectorFile = path.join(dir, 'config', 'modes', 'collector-b5.json');
    fs.mkdirSync(path.dirname(storageFile), { recursive: true });
    fs.mkdirSync(path.dirname(collectorFile), { recursive: true });
    const conversion = { resources: {} };
    const storage = { sell: { enabled: true, blockOnly: true, reserveCoverage: 1.5, allowSingle: false, allowAll: false } };
    const collector = {
        enabled: true, teleportHomeOnEnable: true,
        pickupLocation: { x: 0, y: 64, z: 0 }, arrivalRadius: 1, reanchorRadius: 2,
        moveTimeoutMs: 30000, pollIntervalMs: 15000, errorRetryMs: 5000, craftLoopDelayMs: 250,
        b1Decompression: { maxUsageRatio: 0.8, requireKnownCapacity: true }
    };
    fs.writeFileSync(storageFile, `${JSON.stringify(storage, null, 2)}\n`);
    fs.writeFileSync(collectorFile, `${JSON.stringify(collector, null, 2)}\n`);

    let snapshot = { mineralConversions: conversion, storage, collectorB5Mode: collector };
    const applied = [];
    const controller = new DesktopController({ baseDir: dir });
    controller.lifecycle = 'RUNNING';
    controller.bundle = {
        fleetControl: { profileSnapshot: () => ({ 'bot-01': {}, 'bot-02': {} }) },
        configuration: {
            registry: { require: key => snapshot[key], snapshot: () => snapshot },
            validator: { assertValid() {} },
            crossValidator: {
                assertValid(candidate) {
                    assert.equal(candidate.storage.sell.reserveCoverage, 1.5);
                    assert.equal(candidate.storage.sell.enabled, true);
                    assert.equal(candidate.storage.sell.allowSingle, false);
                    assert.equal(candidate.collectorB5Mode.b1Decompression.maxUsageRatio, 0.84);
                    assert.equal(candidate.mineralConversions.storagePressure, undefined);
                }
            },
            service: {
                async reload(key, relative) {
                    const value = JSON.parse(fs.readFileSync(path.join(dir, relative), 'utf8'));
                    snapshot = { ...snapshot, [key]: value };
                    return { success: true };
                }
            }
        },
        application: {
            listRuntimes: () => ['bot-01', 'bot-02'].map(botId => ({
                botId,
                getService(name) {
                    if (name === 'b1Materials') return { reconfigure: values => applied.push([botId, 'b1', values]) };
                    if (name === 'collectorB5Mode') return { reconfigure: values => applied.push([botId, 'collector', values]) };
                    return null;
                }
            }))
        }
    };

    const result = await controller.updateStorageProtectionConfig({
        sell: { reserveCoverage: 2.5, enabled: false, blockOnly: false },
        collector: { b1Decompression: { maxUsageRatio: 0.84, requireKnownCapacity: true } }
    });

    assert.equal(result.appliedLive, true);
    assert.equal(result.restartRequired, false);
    assert.deepEqual(result.botsApplied, ['bot-01', 'bot-02']);
    assert.equal(applied.filter(entry => entry[1] === 'b1').length, 2);
    assert.equal(applied.filter(entry => entry[1] === 'collector').length, 2);
    assert.equal(applied.find(entry => entry[1] === 'b1')[2].storageConfig.sell.reserveCoverage, 1.5);
    assert.equal(applied.find(entry => entry[1] === 'b1')[2].storageConfig.sell.enabled, true);
    assert.equal(applied.find(entry => entry[1] === 'b1')[2].storageConfig.sell.blockOnly, false);
    assert.equal(applied.find(entry => entry[1] === 'collector')[2].b1Decompression.maxUsageRatio, 0.84);
    assert.equal(JSON.parse(fs.readFileSync(storageFile, 'utf8')).sell.reserveCoverage, 1.5);
    assert.equal(JSON.parse(fs.readFileSync(storageFile, 'utf8')).sell.enabled, true);
    assert.equal(JSON.parse(fs.readFileSync(collectorFile, 'utf8')).b1Decompression.maxUsageRatio, 0.84);
    fs.rmSync(dir, { recursive: true, force: true });
});


test('DesktopController isolates log listener and persistence failures but exposes both in snapshot diagnostics', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-desktop-log-failure-'));
    const blockedBase = path.join(root, 'not-a-directory');
    fs.writeFileSync(blockedBase, 'file');
    const controller = new DesktopController({ baseDir: blockedBase });
    controller.onLog(() => { throw new Error('listener boom'); });
    controller.reportRendererError({ message: 'renderer boom', source: 'runtime-test' });
    const snapshot = controller.snapshot();
    assert.match(snapshot.system.logListenerFailure?.error?.message || '', /listener boom/);
    assert.ok(snapshot.system.logPersistenceFailure?.error?.message);
    fs.rmSync(root, { recursive: true, force: true });
});

test('DesktopController persists an exact bot log beside the aggregate desktop log', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-desktop-bot-log-'));
    const controller = new DesktopController({
        baseDir: root,
        applicationFactory: async ({ output }) => {
            output({
                timestamp: '2026-08-25T22:00:00.000+07:00',
                level: 'info',
                scope: 'BotRuntime:bot-01',
                message: 'bot scoped event',
                meta: { step: 'test' }
            });
            return {
                application: {
                    async initialize() {}, async start() {}, async stop() {}, async destroy() {},
                    listRuntimes() { return []; }, getState() { return 'RUNNING'; }
                }
            };
        }
    });
    await controller.start();
    const botFile = path.join(root, 'data', 'logs', 'bots', 'bot-01', 'mcbot-desktop-bot-01-2026-08-25.jsonl');
    for (let attempt = 0; attempt < 20 && (!fs.existsSync(botFile) || fs.statSync(botFile).size === 0); attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(fs.existsSync(botFile) && fs.statSync(botFile).size > 0, true);
    const record = JSON.parse(fs.readFileSync(botFile, 'utf8').trim().split('\n')[0]);
    assert.equal(record.meta.botId, 'bot-01');
    assert.equal(record.message, 'bot scoped event');
    assert.equal(fs.existsSync(path.join(root, 'data', 'logs', 'mcbot-desktop-2026-08-25.jsonl')), true);
    await controller.stop('test complete');
    await new Promise(resolve => setTimeout(resolve, 10));
    fs.rmSync(root, { recursive: true, force: true });
});
