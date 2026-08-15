'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CancellationSource = require('../../../../src/shared/cancellation/CancellationSource');
const FishingService = require('../../../../src/server-features/fishing/FishingService');

const rod = () => ({ name: 'fishing_rod' });

function harness({ heldItem = null, offhand = null, slots = null, fish = async () => {}, generation = 1, config = {} } = {}) {
    let currentGeneration = generation;
    let currentBot;
    const inventorySlots = slots || Array(46).fill(null);
    inventorySlots[45] = offhand;
    const looks = [];
    const bot = {
        heldItem,
        entity: { yaw: 1.25, pitch: 0 },
        inventory: {
            slots: inventorySlots,
            firstEmptyInventorySlot: () => inventorySlots.findIndex((item, index) => index >= 9 && index < 36 && !item)
        },
        setQuickBarSlot(index) { this.heldItem = inventorySlots[36 + index] || null; },
        async unequip(hand) {
            if (hand === 'off-hand') inventorySlots[45] = null;
            else this.heldItem = null;
        },
        async equip(item) { this.heldItem = item; },
        fish
    };
    currentBot = bot;
    const context = {
        require: () => currentBot,
        get: () => currentBot,
        getGeneration: () => currentGeneration
    };
    const service = new FishingService({
        context,
        rotationService: { look: async (...args) => { looks.push(args); bot.entity.pitch = args[1]; } },
        config: { rodMaterial: 'fishing_rod', lookPitchDegrees: 85, biteTimeoutMs: 20, positionGuardPollMs: 2, bobberMaxDistance: 32, recastDelayMs: 0, ...config }
    });
    return { bot, service, looks, slots: inventorySlots, setGeneration: value => { currentGeneration = value; }, setBot: value => { currentBot = value; } };
}

test('FishingService equips/stows rod and aims through rotation service', async () => {
    const h = harness();
    h.slots[10] = rod();
    const equipped = await h.service.equipRod({ expectedGeneration: 1 });
    assert.equal(equipped.equipped, true);
    assert.equal(h.bot.heldItem.name, 'fishing_rod');
    const aim = await h.service.aimDown(30);
    assert.equal(Math.round(aim.pitchDegrees), -30);
    assert.equal(h.looks.length, 1);
    h.slots[36] = { name: 'stone' };
    const stowed = await h.service.stowRod({ expectedGeneration: 1 });
    assert.equal(stowed.stowed, true);
    assert.equal(h.service.isRod(h.bot.heldItem), false);
    assert.equal(h.service.publicConfig().rodMaterial, 'fishing_rod');
    assert.equal(h.service.reconfigure({ rodMaterial: 'fishing_rod', biteTimeoutMs: 25 }).biteTimeoutMs, 25);
});

test('FishingService handles offhand stow and inventory-space failures', async () => {
    const h = harness({ offhand: rod() });
    await h.service.stowRod({ expectedGeneration: 1 });
    assert.equal(h.slots[45], null);

    const full = Array(46).fill({ name: 'stone' });
    full[45] = rod();
    const blocked = harness({ slots: full, offhand: rod() });
    blocked.bot.inventory.firstEmptyInventorySlot = () => -1;
    await assert.rejects(blocked.service.stowRod({ expectedGeneration: 1 }), error => error.code === 'FISHING_CANNOT_STOW_OFFHAND_ROD');
});

test('FishingService main-hand stow handles no safe quickbar and no inventory space', async () => {
    const full = Array(46).fill(rod());
    full[45] = null;
    const blocked = harness({ heldItem: rod(), slots: full });
    blocked.bot.inventory.firstEmptyInventorySlot = () => -1;
    await assert.rejects(blocked.service.stowRod({ expectedGeneration: 1 }), error => error.code === 'FISHING_CANNOT_STOW_MAINHAND_ROD');

    const movable = Array(46).fill(rod());
    movable[20] = null;
    movable[45] = null;
    const ok = harness({ heldItem: rod(), slots: movable });
    ok.bot.inventory.firstEmptyInventorySlot = () => 20;
    await ok.service.stowRod({ expectedGeneration: 1 });
    assert.equal(ok.bot.heldItem, null);
});

test('FishingService reports rod unavailable and equip verification failure', async () => {
    const missing = harness();
    await assert.rejects(missing.service.equipRod({ expectedGeneration: 1 }), error => error.code === 'FISHING_ROD_NOT_FOUND' && error.retryable === false);

    const bad = harness();
    bad.slots[9] = rod();
    bad.bot.equip = async () => {};
    await assert.rejects(bad.service.equipRod({ expectedGeneration: 1 }), error => error.code === 'FISHING_ROD_EQUIP_VERIFY_FAILED');
    const already = harness({ heldItem: rod() });
    assert.equal((await already.service.equipRod({ expectedGeneration: 1 })).alreadyEquipped, true);
});

test('FishingService aim clamps/falls back pitch and supports both guard contracts', async () => {
    const h = harness({ heldItem: rod(), fish: async () => {} });
    assert.equal((await h.service.aimDown(120)).pitchDegrees, -89);
    assert.equal((await h.service.aimDown('bad')).pitchDegrees, -85);
    assert.equal((await h.service.fishOnce({ positionGuard: { verify: () => ({ valid: true }) }, expectedGeneration: 1 })).caught, true);
    assert.equal((await h.service.fishOnce({ positionGuard: () => true, expectedGeneration: 1 })).caught, true);
});

test('FishingService successful fishing and server-auto completion preserve rod and guard', async () => {
    let guardValid = true;
    const guard = { verifyCurrent: () => ({ valid: guardValid }) };
    const success = harness({ heldItem: rod(), fish: async () => 'caught' });
    const result = await success.service.fishOnce({ positionGuard: guard, expectedGeneration: 1, pitchDegrees: 20 });
    assert.equal(result.caught, true);
    assert.equal(result.signal, 'mineflayer-fish-complete');

    const auto = harness({ heldItem: rod(), fish: async () => { throw new Error('Fishing cancelled'); } });
    const autoResult = await auto.service.fishOnce({ positionGuard: guard, expectedGeneration: 1 });
    assert.equal(autoResult.serverAutoCompleted, true);
    assert.equal(autoResult.signal, 'server-bobber-destroyed');

    guardValid = false;
    await assert.rejects(success.service.fishOnce({ positionGuard: guard, expectedGeneration: 1 }), error => error.code === 'FISHING_POSITION_NOT_READY');
});

test('FishingService returns bounded timeout and ordinary cycle retry without route reset', async () => {
    const timeout = harness({ heldItem: rod(), fish: () => new Promise(() => {}), config: { biteTimeoutMs: 15 } });
    const timeoutResult = await timeout.service.fishOnce({ positionGuard: () => true, expectedGeneration: 1 });
    assert.equal(timeoutResult.timeout, true);
    assert.equal(timeoutResult.signal, 'fish-timeout');

    const ordinary = harness({ heldItem: rod(), fish: async () => { throw new Error('temporary network-ish fishing error'); } });
    const retry = await ordinary.service.fishOnce({ positionGuard: () => true, expectedGeneration: 1 });
    assert.equal(retry.retry, true);
    assert.equal(retry.signal, 'fish-cycle-error');

    const overlap = harness({ heldItem: rod(), fish: async () => { throw new Error('Fishing cancelled due to calling bot.fish() again'); } });
    assert.equal((await overlap.service.fishOnce({ positionGuard: () => true, expectedGeneration: 1 })).retry, true);
});

test('FishingService cancellation cleans guard timer and propagates CANCELLED', async () => {
    const source = new CancellationSource();
    const h = harness({ heldItem: rod(), fish: () => new Promise(() => {}), config: { biteTimeoutMs: 1000, positionGuardPollMs: 2 } });
    const pending = h.service.fishOnce({ positionGuard: () => true, expectedGeneration: 1, cancellationToken: source.token });
    setImmediate(() => source.cancel('pause'));
    await assert.rejects(pending, error => error.code === 'CANCELLED');
});

test('FishingService detects guard loss during cycle and stale generation across async operations', async () => {
    let checks = 0;
    const guard = { verifyCurrent: () => ({ valid: ++checks < 2 }) };
    const h = harness({ heldItem: rod(), fish: () => new Promise(resolve => setTimeout(resolve, 10)), config: { positionGuardPollMs: 2, biteTimeoutMs: 50 } });
    await assert.rejects(h.service.fishOnce({ positionGuard: guard, expectedGeneration: 1 }), error => error.code === 'FISHING_POSITION_LOST');

    const stale = harness(); stale.slots[10] = rod();
    stale.bot.equip = async item => { stale.bot.heldItem = item; stale.setGeneration(2); };
    await assert.rejects(stale.service.equipRod({ expectedGeneration: 1 }), error => error.code === 'FISHING_STALE_GENERATION');

    const post = harness({ heldItem: rod(), fish: async () => {} });
    let postChecks = 0;
    const postGuard = { verifyCurrent: () => ({ valid: ++postChecks === 1 }) };
    await assert.rejects(post.service.fishOnce({ positionGuard: postGuard, expectedGeneration: 1 }), error => error.code === 'FISHING_POSITION_LOST');

    const fishStale = harness({ heldItem: rod() });
    fishStale.bot.fish = async () => { fishStale.setGeneration(2); };
    await assert.rejects(fishStale.service.fishOnce({ expectedGeneration: 1 }), error => error.code === 'FISHING_STALE_GENERATION');
});

test('FishingService rejects missing fishing API and rod loss after cycle', async () => {
    const noApi = harness({ heldItem: rod() });
    noApi.bot.fish = null;
    await assert.rejects(noApi.service.fishOnce({ expectedGeneration: 1 }), error => error.code === 'FISHING_API_UNAVAILABLE');

    const lost = harness({ heldItem: rod() });
    lost.bot.fish = async () => { lost.bot.heldItem = null; };
    await assert.rejects(lost.service.fishOnce({ expectedGeneration: 1 }), error => error.code === 'FISHING_ROD_NOT_EQUIPPED');
});
