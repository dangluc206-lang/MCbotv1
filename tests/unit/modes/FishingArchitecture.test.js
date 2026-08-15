'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fishingSchema = require('../../../src/configuration/schemas/fishing.schema');
const resolveFishingConfig = require('../../../src/modes/fishing/resolveFishingConfig');

const root = path.resolve(__dirname, '../../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('FishingModeService architecture boundary forbids raw Mineflayer/protocol/control access', () => {
    const source = read('src/modes/fishing/FishingModeService.js');
    const forbidden = [
        /BotContext/, /\bcontext\b/, /\bbot\s*\./, /\bclient\s*\./, /_client/,
        /setControlState/, /getControlState/, /controlState/, /bot\.end/, /bot\.fish/,
        /bot\.look/, /lookAt/, /blockAt/, /physicsTick/, /forcedMove/, /entity_velocity/,
        /waitForChunksToLoad/, /pathfinder/, /\bVec3\b/
    ];
    for (const pattern of forbidden) assert.equal(pattern.test(source), false, `forbidden boundary: ${pattern}`);
    assert.equal(source.includes("require('../../bot/BotContext')"), false);
});

test('raw fishing/protocol/control ownership is confined to explicit lower-level owners', () => {
    const packet = read('src/modes/fishing/ConnectionPacketObserver.js');
    const fishing = read('src/server-features/fishing/FishingService.js');
    const movement = read('src/modes/fishing/FishingMovementOperation.js');
    assert.equal(packet.includes('._client'), true);
    assert.equal(fishing.includes('bot.fish()'), true);
    assert.equal(movement.includes('controlStateManager.set'), true);
    assert.equal(movement.includes('bot.setControlState'), false);
});

test('touched fishing/runtime hardening files contain no empty catch or unconditional swallowed rejection', () => {
    const files = [
        'src/modes/fishing/ConnectionPacketObserver.js',
        'src/modes/fishing/ConnectionStateView.js',
        'src/modes/fishing/FishingModeService.js',
        'src/modes/fishing/FishingMovementOperation.js',
        'src/modes/fishing/FishingMovementProbeService.js',
        'src/modes/fishing/FishingPositionGuard.js',
        'src/modes/fishing/FishingRecoveryPolicy.js',
        'src/modes/fishing/FishingWorldReadinessService.js',
        'src/modes/fishing/resolveFishingConfig.js',
        'src/server-features/fishing/FishingService.js',
        'src/server-features/afk/AfkAreaService.js',
        'src/server-features/island/IslandService.js',
        'src/server-features/island/IslandTeleportOperation.js',
        'src/bot/BotRegistry.js',
        'src/diagnostics/runtime/RuntimeFailurePublisher.js',
        'src/connection/ConnectionManager.js',
        'src/bootstrap/registerBotServices.js',
        'src/configuration/schemas/fishing.schema.js'
    ];
    for (const file of files) {
        const source = read(file);
        assert.equal(/catch\s*\{\s*\}/m.test(source), false, `${file}: empty catch`);
        assert.equal(/\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/m.test(source), false, `${file}: swallowed promise rejection`);
    }
});

test('fishing schema validates current config, rejects unknown keys and invalid/duplicate destinations', () => {
    const current = JSON.parse(read('config/modes/fishing.json'));
    assert.deepEqual(fishingSchema(current), { valid: true, errors: [] });
    const unknown = structuredClone(current); unknown.movement.magic = 1;
    assert.equal(fishingSchema(unknown).valid, false);
    const invalid = structuredClone(current); invalid.areas[0].destination.x = Infinity;
    assert.equal(fishingSchema(invalid).valid, false);
    const duplicate = structuredClone(current); duplicate.areas[1].id = duplicate.areas[0].id;
    assert.equal(fishingSchema(duplicate).valid, false);
    const duplicatePriority = structuredClone(current); duplicatePriority.areas[1].priority = duplicatePriority.areas[0].priority;
    assert.equal(fishingSchema(duplicatePriority).valid, false);
});

test('resolveFishingConfig validates merged bot overrides and preserves server coordinates by default', () => {
    const shared = JSON.parse(read('config/modes/fishing.json'));
    const originalDestination = { ...shared.areas[0].destination };
    const unchanged = resolveFishingConfig(shared, {});
    assert.deepEqual(unchanged.areas[0].destination, originalDestination);
    const overridden = resolveFishingConfig(shared, {
        shoreFishingPitchDegrees: 12,
        areas: { [shared.areas[0].id]: { x: 75, y: 70, z: 91 } }
    });
    assert.deepEqual(overridden.areas[0].destination, { x: 75, y: 70, z: 91 });
    assert.equal(overridden.movement.shoreFishingPitchDegrees, 12);
    assert.throws(() => resolveFishingConfig(shared, { shoreFishingPitchDegrees: 100 }), /invalid/i);
    const nullOverride = resolveFishingConfig(shared, { areas: { [shared.areas[0].id]: { x: null } } });
    assert.equal(nullOverride.areas[0].destination.x, originalDestination.x);
});
