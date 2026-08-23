'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const DurableIntentStore = require('../../../src/recovery/DurableIntentStore');
const FleetControlService = require('../../../src/recovery/FleetControlService');
const FleetScheduler = require('../../../src/fleet/FleetScheduler');
const BotRegistry = require('../../../src/bot/BotRegistry');
const ModeCatalog = require('../../../src/modes/ModeCatalog');
const RuntimeModeRegistry = require('../../../src/modes/RuntimeModeRegistry');
const CapabilityRegistry = require('../../../src/core/registry/CapabilityRegistry');
const EventBus = require('../../../src/core/EventBus');
const Result = require('../../../src/shared/result/Result');

function fakeMode() {
    const state = { enabled: false, paused: false };
    return {
        status: () => ({ ...state }),
        async enable() { state.enabled = true; state.paused = false; return Result.ok(this.status()); },
        async disable() { state.enabled = false; state.paused = false; return Result.ok(this.status()); },
        async pause() { state.paused = true; return Result.ok(this.status()); },
        async resume() { state.paused = false; return Result.ok(this.status()); }
    };
}

test('custom catalog mode survives durable intent and fleet reconciliation without core hard-coding', async t => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-mode-durable-'));
    t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
    const catalog = new ModeCatalog([{ id: 'mining', serviceName: 'miningMode', requiredCapabilities: ['movement'] }]).seal();
    const capabilities = new CapabilityRegistry({ botId: 'bot-01' }).register('movement', {}).seal();
    const mining = fakeMode();
    const modeRegistry = new RuntimeModeRegistry({ botId: 'bot-01', catalog, capabilityRegistry: capabilities, services: { miningMode: mining } });
    const eventBus = new EventBus();
    const runtime = {
        botId: 'bot-01',
        context: { has: () => true },
        getState: () => ({ lifecycleState: 'RUNNING' }),
        getService(name) {
            return {
                modeRegistry,
                eventBus,
                operationManager: { cancelAll() {} },
                movementManager: { async stop() {} },
                guiManager: { async closeCurrentWindow() {} },
                connectionManager: { async connect() {}, async stop() {} }
            }[name] || null;
        },
        requireService(name) {
            const service = this.getService(name);
            if (!service) throw new Error(`missing ${name}`);
            return service;
        }
    };
    const botRegistry = new BotRegistry();
    botRegistry.register(runtime);
    const store = new DurableIntentStore({ baseDir, file: 'data/intents.json', modeCatalog: catalog });
    const scheduler = new FleetScheduler({ concurrency: 1, maxPending: 8, taskTimeoutMs: 1000, shutdownDrainMs: 200 });
    const control = new FleetControlService({ store, scheduler, botRegistry, modeCatalog: catalog });
    control.setProfiles([{ id: 'bot-01', enabled: true }]);
    await control.initialize();
    await control.start();
    t.after(async () => control.destroy());

    const result = await control.requestMode('bot-01', 'mining', { source: 'unit-mining' });
    assert.equal(result.success, true);
    assert.equal(mining.status().enabled, true);
    assert.equal(store.get('bot-01').desiredMode, 'mining');
    assert.equal(control.status().intents.intents['bot-01'].desiredMode, 'mining');
});
