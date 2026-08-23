'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CollectorB5ModeCommand = require('../../../src/discord/commands/CollectorB5ModeCommand');
const FishingModeCommand = require('../../../src/discord/commands/FishingModeCommand');

function interaction(commandName, action) {
    const replies = [];
    return {
        commandName,
        user: { id: 'operator' },
        isChatInputCommand: () => true,
        options: { getString: name => name === 'action' ? action : null },
        async reply(payload) { replies.push(payload); },
        replies
    };
}

function setup(Command, { commandName, serviceName, modeId }) {
    let enabled = false;
    let intent = null;
    let directDisableCalls = 0;
    const requests = [];
    const mode = {
        status() {
            return serviceName === 'fishingMode'
                ? { enabled, phase: enabled ? 'FISHING' : 'DISABLED', currentAreaId: null, areas: [], catches: 0 }
                : { enabled, phase: enabled ? 'COLLECTING' : 'OFF', pickupLocation: null, craftedB5Cycles: 0 };
        },
        async disable() { directDisableCalls += 1; enabled = false; return { success: true, data: this.status() }; }
    };
    const fleetControl = {
        intent: () => intent,
        async requestMode(botId, requestedMode, options) {
            requests.push({ botId, requestedMode, options });
            intent = requestedMode ? { desiredMode: requestedMode } : { desiredMode: null };
            enabled = requestedMode === modeId;
            return { success: true, data: { modeStatus: mode.status() } };
        }
    };
    const runtime = {
        context: { has: () => false },
        requireService(name) { assert.equal(name, serviceName); return mode; }
    };
    const command = new Command({
        botRegistry: { require: botId => { assert.equal(botId, 'bot-01'); return runtime; } },
        config: {
            defaultBotId: 'bot-01',
            ephemeral: true,
            modeCommandName: 'mode',
            fishingModeCommandName: 'fishmode'
        },
        allowedUserIds: ['operator'],
        fleetControl
    });
    return {
        command,
        requests,
        setIntent(value) { intent = value; },
        directDisableCalls: () => directDisableCalls
    };
}

for (const definition of [
    { Command: CollectorB5ModeCommand, commandName: 'mode', serviceName: 'collectorB5Mode', modeId: 'collector-b5' },
    { Command: FishingModeCommand, commandName: 'fishmode', serviceName: 'fishingMode', modeId: 'fishing' }
]) {
    test(`${definition.commandName} persists on/off intent through fleet control while offline`, async () => {
        const fixture = setup(definition.Command, definition);
        const on = interaction(definition.commandName, 'on');
        assert.equal(await fixture.command.execute(on), true);
        assert.equal(fixture.requests[0].requestedMode, definition.modeId);
        assert.equal(fixture.requests[0].options.state, 'ACTIVE');
        assert.match(on.replies[0].content, /ON/);

        const off = interaction(definition.commandName, 'off');
        assert.equal(await fixture.command.execute(off), true);
        assert.equal(fixture.requests[1].requestedMode, null);
        assert.match(off.replies[0].content, /OFF/);
    });

    test(`${definition.commandName} does not clear the other durable primary mode`, async () => {
        const fixture = setup(definition.Command, definition);
        fixture.setIntent({ desiredMode: definition.modeId === 'fishing' ? 'collector-b5' : 'fishing' });
        const off = interaction(definition.commandName, 'off');
        await fixture.command.execute(off);
        assert.equal(fixture.requests.length, 0);
        assert.equal(fixture.directDisableCalls(), 1);
    });
}
