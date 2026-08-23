'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ConfigSpecs = require('../../../src/configuration/ConfigSpecs');
const ConfigRegistry = require('../../../src/configuration/ConfigRegistry');
const ConfigValidator = require('../../../src/configuration/ConfigValidator');
const ConfigurationService = require('../../../src/configuration/ConfigurationService');
const ConfigurationContractValidator = require('../../../src/configuration/ConfigurationContractValidator');
const appSchema = require('../../../src/configuration/schemas/app.schema');
const botSchema = require('../../../src/configuration/schemas/bot.schema');
const serverSchema = require('../../../src/configuration/schemas/server.schema');
const discordSchema = require('../../../src/configuration/schemas/discord.schema');
const fishingSchema = require('../../../src/configuration/schemas/fishing.schema');
const groupSchemas = require('../../../src/configuration/schemas/group.schemas');

const ROOT = path.resolve(__dirname, '../../..');
const schemas = {
    app: appSchema,
    bot: botSchema,
    server: serverSchema,
    discord: discordSchema,
    fishing: fishingSchema,
    ...groupSchemas
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function snapshot() {
    return Object.fromEntries(ConfigSpecs.map(spec => [
        spec.key,
        JSON.parse(fs.readFileSync(path.join(ROOT, spec.file), 'utf8'))
    ]));
}

function botProfiles() {
    return fs.readdirSync(path.join(ROOT, 'config/bots'))
        .filter(name => name.endsWith('.json'))
        .sort()
        .map(name => JSON.parse(fs.readFileSync(path.join(ROOT, 'config/bots', name), 'utf8')));
}

function assertContractError(mutator, pattern) {
    const candidate = snapshot();
    mutator(candidate);
    const result = new ConfigurationContractValidator().validate(candidate, { botProfiles: botProfiles() });
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), pattern);
}

test('all active configuration groups have schemas, validate, and reject unknown top-level entries', () => {
    assert.equal(ConfigSpecs.length, 32);
    for (const spec of ConfigSpecs) {
        assert.equal(typeof spec.schema, 'string', `${spec.key} must declare a schema`);
        const validate = schemas[spec.schema];
        assert.equal(typeof validate, 'function', `${spec.key} schema ${spec.schema} must exist`);
        const value = snapshot()[spec.key];
        const valid = validate(value);
        assert.equal(valid.valid, true, `${spec.key}: ${valid.errors.join('; ')}`);
        const unknown = clone(value);
        unknown.__unexpected = true;
        const rejected = validate(unknown);
        assert.equal(rejected.valid, false, `${spec.key} accepted an unknown top-level entry`);
    }
});


test('mineral conversion schema enforces the complete ordered B5 smelting contract', () => {
    const valid = snapshot().mineralConversions;
    for (const recipeIds of [
        ['raw_iron_to_iron'],
        ['raw_gold_to_gold'],
        ['raw_gold_to_gold', 'raw_iron_to_iron'],
        ['raw_iron_to_iron', 'raw_gold_to_gold', 'cobblestone_to_stone']
    ]) {
        const candidate = clone(valid);
        candidate.smeltingRecipeIds = recipeIds;
        const result = groupSchemas.mineralConversions(candidate);
        assert.equal(result.valid, false, `schema must reject ${JSON.stringify(recipeIds)}`);
        assert.match(result.errors.join('\n'), /must be exactly \[raw_iron_to_iron, raw_gold_to_gold\] in that order/);
    }
    const canonical = clone(valid);
    canonical.smeltingRecipeIds = ['raw_iron_to_iron', 'raw_gold_to_gold'];
    assert.equal(groupSchemas.mineralConversions(canonical).valid, true);
});

test('storage schema enforces the non-configurable B5 64-only sell contract', () => {
    const valid = snapshot().storage;
    assert.equal(valid.sell.allowSingle, false);
    assert.equal(groupSchemas.storage(valid).valid, true);

    const legacySingle = clone(valid);
    legacySingle.sell.allowSingle = true;
    const result = groupSchemas.storage(legacySingle);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /allowSingle must be false for the B5 64-only sell contract/);
});

test('current full snapshot and bot profiles satisfy every cross-reference contract', () => {
    const result = new ConfigurationContractValidator().validate(snapshot(), { botProfiles: botProfiles() });
    assert.deepEqual(result, { valid: true, errors: [] });
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.errors), true);
});

test('cross validation rejects missing command and GUI references and out-of-range slots', () => {
    assertContractError(value => { value.island.commandKey = 'missing'; }, /missing command: missing/);
    assertContractError(value => { value.skyCommands.missingSky = {}; }, /missing Skyblock selection: missingSky/);
    assertContractError(value => { value.personalVault.guiId = 'missing'; }, /missing GUI window: missing/);
    assertContractError(value => { value.skyblock.selections.primary.slot = 99; }, /outside skyServerSelect slotCount 63/);
});

test('cross validation rejects missing item references, duplicate outputs, recipe cycles, and invalid B5 target', () => {
    assertContractError(value => { value.recipes.super_alloy.output = 'missing_item'; }, /missing item: missing_item/);
    assertContractError(value => { value.recipes.refined_coal.output = value.recipes.super_cobblestone.output; }, /duplicates recipe/);
    assertContractError(value => {
        value.recipes.super_cobblestone.inputs.super_alloy = 1;
    }, /recipe dependency cycle/);
    assertContractError(value => { value.b5.targetId = 'coal'; }, /must belong to craftingTiers\.B5/);
});

test('cross validation enforces strong identity coverage and uniqueness for every B2-B5 item', () => {
    assertContractError(value => {
        delete value.items.tungsten.representations.inventory;
    }, /tungsten must configure strong identity rules for inventory and personal-vault, or set metadata\.strongIdentityPolicy=learn/);

    assertContractError(value => {
        value.items.titanium.representations.inventory.rules = [{ type: 'identity', value: 'MMOITEMS_ITEM_ID:CACBON' }];
        value.items.titanium.representations['personal-vault'].rules = [{ type: 'identity', value: 'MMOITEMS_ITEM_ID:CACBON' }];
    }, /strong identity MMOITEMS_ITEM_ID:CACBON is configured for both carbon and titanium/);

    assertContractError(value => {
        value.items.tungsten.metadata = { strongIdentityPolicy: 'learn' };
        value.items.tungsten.representations.inventory = { rules: [{ type: 'identity', value: 'MMOITEMS_ITEM_ID:TUNGSTEN' }] };
    }, /strongIdentityPolicy=learn but also configures a fixed inventory\/personal-vault identity/);
});

test('cross validation rejects route, bot/server, fishing-area, and Discord bot reference errors', () => {
    assertContractError(value => { value.routes.mine = ['missing']; }, /missing location: missing/);
    const profiles = botProfiles();
    profiles[0].serverProfile = 'missing';
    let result = new ConfigurationContractValidator().validate(snapshot(), { botProfiles: profiles });
    assert.match(result.errors.join('\n'), /missing server profile: missing/);

    profiles[0].serverProfile = 'default';
    profiles[0].fishing.areas.missing = { x: 1, y: 2, z: 3 };
    result = new ConfigurationContractValidator().validate(snapshot(), { botProfiles: profiles });
    assert.match(result.errors.join('\n'), /missing fishing area: missing/);

    const candidate = snapshot();
    candidate.discord.defaultBotId = 'missing';
    result = new ConfigurationContractValidator().validate(candidate, { botProfiles: botProfiles() });
    assert.match(result.errors.join('\n'), /discord\.defaultBotId references missing bot profile/);
});

test('cross validation rejects Collector decompression, mode geometry, and overlapping recovery windows', () => {
    assertContractError(value => {
        value.collectorB5Mode.b1Decompression.maxUsageRatio = 1.1;
    }, /maxUsageRatio must be in \(0, 1\]/);
    assertContractError(value => { value.collectorB5Mode.reanchorRadius = 0.5; }, /reanchorRadius must be >= arrivalRadius/);
    assertContractError(value => {
        value.dailyRecovery.server.hour = value.dailyRecovery.sky.hour;
        value.dailyRecovery.server.minute = value.dailyRecovery.sky.minute + 1;
    }, /window overlaps/);
});

test('ConfigRegistry publishes immutable snapshots and replaceAll is atomic on validation failure', () => {
    const registry = new ConfigRegistry();
    registry.replaceAll({ first: { nested: { value: 1 } }, second: [1, 2] });
    const before = registry.snapshot();
    assert.equal(Object.isFrozen(before), true);
    assert.equal(Object.isFrozen(before.first.nested), true);
    assert.throws(() => registry.replaceAll({ first: 1, '': 2 }), /non-empty string/);
    assert.deepEqual(registry.snapshot(), before);
});

test('loadAll validates the complete candidate before publishing any group', async () => {
    const registry = new ConfigRegistry();
    registry.replaceAll({ accepted: { value: 1 } });
    const loader = { load: async file => file === 'good' ? { value: 2 } : { value: -1 } };
    const validator = new ConfigValidator({ positive: value => ({
        valid: Number(value?.value) > 0,
        errors: Number(value?.value) > 0 ? [] : ['value must be positive']
    }) });
    const service = new ConfigurationService({ loader, validator, registry });
    const result = await service.loadAll([
        { key: 'good', file: 'good', schema: 'positive' },
        { key: 'bad', file: 'bad', schema: 'positive' }
    ]);
    assert.equal(result.success, false);
    assert.deepEqual(registry.snapshot(), { accepted: { value: 1 } });
});

test('reload keeps the old registry on cross-validation or runtime apply failure and calls rollback', async () => {
    const registry = new ConfigRegistry();
    registry.replaceAll({ first: { value: 1 }, second: { value: 2 } });
    const validator = new ConfigValidator({ number: value => ({ valid: Number.isFinite(value?.value), errors: [] }) });
    const crossValidator = {
        assertValid(candidate) {
            if (candidate.first.value >= candidate.second.value) throw new Error('invalid ordering');
        }
    };
    const service = new ConfigurationService({
        loader: { load: async () => ({ value: 3 }) },
        validator,
        registry,
        crossValidator,
        specs: [{ key: 'first', file: 'first', schema: 'number' }]
    });
    let applied = 0;
    let rolledBack = 0;
    let result = await service.reload('first', 'first');
    assert.equal(result.success, false);
    assert.deepEqual(registry.snapshot(), { first: { value: 1 }, second: { value: 2 } });

    service.loader = { load: async () => ({ value: 0 }) };
    result = await service.reload('first', 'first', null, {
        apply: async () => { applied += 1; throw new Error('apply failed'); },
        rollback: async previous => { rolledBack += previous.value; }
    });
    assert.equal(result.success, false);
    assert.equal(applied, 1);
    assert.equal(rolledBack, 1);
    assert.deepEqual(registry.snapshot(), { first: { value: 1 }, second: { value: 2 } });
});
