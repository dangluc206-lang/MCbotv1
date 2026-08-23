'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventBus = require('../../../src/core/EventBus');
const DiscordPanelManager = require('../../../src/discord/panels/DiscordPanelManager');

function modeState() {
    let enabled = false;
    let paused = false;
    return {
        status: () => ({ enabled, paused, phase: enabled ? (paused ? 'PAUSED' : 'ACTIVE') : 'OFF' }),
        set(nextEnabled, nextPaused = false) { enabled = nextEnabled; paused = nextPaused; },
        async enable() { enabled = true; paused = false; return { success: true, data: this.status() }; },
        async disable() { enabled = false; paused = false; return { success: true, data: this.status() }; },
        async pause() { paused = true; return { success: true, data: this.status() }; },
        async resume() { paused = false; return { success: true, data: this.status() }; }
    };
}

function createFixture() {
    const b5 = modeState();
    const collector = modeState();
    const fishing = modeState();
    const services = {
        eventBus: new EventBus(), b5CraftMode: b5, collectorB5Mode: collector, fishingMode: fishing,
        modeRegistry: {
            has: id => ['b5-craft', 'collector-b5', 'fishing'].includes(id),
            active() {
                if (b5.status().enabled) return [{ definition: { id: 'b5-craft' }, status: b5.status() }];
                if (collector.status().enabled) return [{ definition: { id: 'collector-b5' }, status: collector.status() }];
                if (fishing.status().enabled) return [{ definition: { id: 'fishing' }, status: fishing.status() }];
                return [];
            },
            require(id) { return id === 'b5-craft' ? b5 : id === 'collector-b5' ? collector : fishing; }
        },
        operationManager: { cancelAll() { return 1; } }, movementManager: { async stop() {} }, guiManager: { describeCurrent: () => null, async closeCurrentWindow() {} },
        connectionManager: { async connect() { throw new Error('direct connect must not run'); } },
        serverFeatureFacade: { island: () => ({ goHome: async () => ({ success: true }) }) },
        skyblockAutoJoin: { status: () => ({ location: 'SKY', ready: true, selection: 'sky1' }), requestJoinNow() {}, holdAtHub() {}, releaseHubHold() {} },
        slashCommandService: { async send() { return { success: true }; } }
    };
    const runtime = {
        botId: 'bot-01', identity: { displayName: 'Bot 01', username: 'Bot01' },
        context: { has: () => true, get: () => ({ entity: { position: { x: 0, y: 64, z: 0 } }, inventory: { slots: [] } }) },
        requireService(name) { const value = services[name]; if (!value) throw new Error(`Missing ${name}`); return value; }, getService: name => services[name] || null
    };
    const requests = [];
    const fleetControl = {
        async requestConnection(botId, desiredConnection, options) { requests.push({ type: 'connection', botId, desiredConnection, options }); return { success: true }; },
        async requestMode(botId, desiredMode, options = {}) {
            requests.push({ type: 'mode', botId, desiredMode, options });
            b5.set(desiredMode === 'b5-craft', desiredMode === 'b5-craft' && options.state === 'PAUSED');
            collector.set(desiredMode === 'collector-b5', desiredMode === 'collector-b5' && options.state === 'PAUSED');
            fishing.set(desiredMode === 'fishing', desiredMode === 'fishing' && options.state === 'PAUSED');
            return { success: true };
        },
        async restartMode(botId, desiredMode, options = {}) { requests.push({ type: 'restart', botId, desiredMode, options }); return { success: true }; }
    };
    const manager = new DiscordPanelManager({
        config: { remoteOnly: true, defaultBotId: 'bot-01', panels: {} },
        botRegistry: { ids: () => ['bot-01'], list: () => [runtime], require: id => { assert.equal(id, 'bot-01'); return runtime; }, onChange: () => () => {} },
        allowedUserIds: ['operator'], configuration: { registry: { require(name) { if (name === 'app') return { diagnostics: { runtimeFailures: { enabled: false, repeatWindowMs: 1000 } } }; if (name === 'fishingMode') return { areas: [] }; throw new Error(name); } } }, fleetControl
    });
    return { manager, requests };
}

function button(action) {
    return { customId: `mcbot:control:bot-01|${action}`, user: { id: 'operator' }, isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false, async deferUpdate() {} };
}

test('Discord remote persists per-bot connection and generic mode lifecycle through fleet control', async () => {
    const f = createFixture();
    for (const action of ['join', 'start-selected-mode', 'pause', 'resume', 'restart-mode', 'stop-mode', 'disconnect']) assert.equal(await f.manager.handleInteraction(button(action)), true);
    assert.deepEqual(f.requests.map(r => r.type === 'connection' ? `${r.type}:${r.desiredConnection}` : `${r.type}:${r.desiredMode}:${r.options.state || '-'}`), [
        'connection:CONNECTED', 'mode:b5-craft:ACTIVE', 'mode:b5-craft:PAUSED', 'mode:b5-craft:ACTIVE', 'restart:b5-craft:-', 'mode:null:-', 'connection:DISCONNECTED'
    ]);
});
