'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const RuntimeConfigMigrator = require('../../../src/desktop/update/RuntimeConfigMigrator');

async function configTreeDigest(root) {
    const rows = [];
    const walk = async (dir, relative = '') => {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            const absolute = path.join(dir, entry.name);
            const rel = path.posix.join(relative.replace(/\\/g, '/'), entry.name);
            if (entry.isDirectory()) {
                rows.push(`D:${rel}`);
                await walk(absolute, rel);
            } else if (entry.isFile()) {
                const content = await fsp.readFile(absolute);
                rows.push(`F:${rel}:${content.length}:${crypto.createHash('sha256').update(content).digest('hex')}`);
            }
        }
    };
    await walk(root);
    return crypto.createHash('sha256').update(rows.join('\n')).digest('hex');
}

function sha256Bytes(bytes) {
    return crypto.createHash('sha256').update(bytes).digest('hex');
}

test('RuntimeConfigMigrator adds new defaults without overwriting user values and can rollback', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-migration-'));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    await fsp.mkdir(path.join(templateRoot, 'config', 'nested'), { recursive: true });
    await fsp.mkdir(path.join(runtimeRoot, 'config', 'nested'), { recursive: true });
    await fsp.writeFile(path.join(templateRoot, 'config', 'nested', 'settings.json'), JSON.stringify({ keep: 1, newField: 7, nested: { a: 1, b: 2 } }, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'nested', 'settings.json'), JSON.stringify({ keep: 99, nested: { a: 42 } }, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), JSON.stringify({ appVersion: '2.3.0' }));

    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.4.0' });
    const report = await migrator.prepare();
    assert.equal(report.fromVersion, '2.3.0');
    assert.ok(report.backup);
    const merged = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'nested', 'settings.json'), 'utf8'));
    assert.deepEqual(merged, { keep: 99, newField: 7, nested: { a: 42, b: 2 } });

    await fsp.writeFile(path.join(runtimeRoot, 'config', 'nested', 'settings.json'), JSON.stringify({ keep: -1 }));
    const rollback = await migrator.rollbackLastConfig();
    assert.ok(rollback.restoredFrom);
    const restored = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'nested', 'settings.json'), 'utf8'));
    assert.deepEqual(restored, { keep: 99, nested: { a: 42 } });
    fs.rmSync(dir, { recursive: true, force: true });
});

test('RuntimeConfigMigrator mergeDefaults keeps arrays/user primitives while adding nested defaults', () => {
    assert.deepEqual(RuntimeConfigMigrator.mergeDefaults({ a: 1, nested: { x: 1, y: 2 }, list: [1,2] }, { nested: { x: 9 }, list: [7] }), { a: 1, nested: { x: 9, y: 2 }, list: [7] });
});

test('RuntimeConfigMigrator upgrades only legacy GUI identity regexes and preserves custom operator values', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-gui-migration-'));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    await fsp.mkdir(path.join(templateRoot, 'config', 'gui'), { recursive: true });
    await fsp.mkdir(path.join(runtimeRoot, 'config', 'gui'), { recursive: true });
    const defaults = {
        storage: { title: { regex: 'ᴋʜᴏ\\s*ᴄʜứᴀ|kho\\s*chua|storage' }, layout: {} },
        personalVault2: { title: { regex: 'ᴋʜᴏ\\s*đồ\\s*#?\\s*2|kho\\s*do\\s*#?\\s*2|pv\\s*2|personal\\s*vault' }, layout: { slotCount: 90 } },
        customGui: { title: { regex: 'new-default' } }
    };
    const legacy = {
        storage: { title: { regex: 'kho|storage' }, layout: {} },
        personalVault2: { title: { regex: 'pv\\s*2|personal\\s*vault' }, layout: { slotCount: 90 } },
        customGui: { title: { regex: 'operator-custom' } }
    };
    await fsp.writeFile(path.join(templateRoot, 'config', 'gui', 'windows.json'), JSON.stringify(defaults, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'gui', 'windows.json'), JSON.stringify(legacy, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), JSON.stringify({ appVersion: '2.6.0' }));

    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.1' });
    const report = await migrator.prepare();
    const migrated = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'gui', 'windows.json'), 'utf8'));

    assert.equal(migrated.storage.title.regex, defaults.storage.title.regex);
    assert.equal(migrated.personalVault2.title.regex, defaults.personalVault2.title.regex);
    assert.equal(migrated.customGui.title.regex, 'operator-custom');
    assert.deepEqual(report.versionMigrations, ['2.6.1-gui-identity-v2-window-defaults']);
    assert.deepEqual(report.migratedFiles, ['config/gui/windows.json']);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('migrated GUI definitions identify the exact MinerUA NBT /kho and /pv 2 titles from runtime logs', async () => {
    const GuiRegistry = require('../../../src/gui/GuiRegistry');
    const TitleMatcher = require('../../../src/gui/detection/TitleMatcher');
    const LayoutMatcher = require('../../../src/gui/detection/LayoutMatcher');
    const GuiIdentityEngine = require('../../../src/gui/identity/GuiIdentityEngine');
    const identityConfig = require('../../../config/gui/identity.json');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-gui-log-fixture-'));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    await fsp.mkdir(path.join(templateRoot, 'config', 'gui'), { recursive: true });
    await fsp.mkdir(path.join(runtimeRoot, 'config', 'gui'), { recursive: true });
    const defaults = require('../../../config/gui/windows.json');
    const legacy = JSON.parse(JSON.stringify(defaults));
    legacy.storage.title.regex = 'kho|storage';
    legacy.personalVault2.title.regex = 'pv\\s*2|personal\\s*vault';
    await fsp.writeFile(path.join(templateRoot, 'config', 'gui', 'windows.json'), JSON.stringify(defaults, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'gui', 'windows.json'), JSON.stringify(legacy, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), JSON.stringify({ appVersion: '2.6.0' }));

    await new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.1' }).prepare();
    const migrated = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'gui', 'windows.json'), 'utf8'));
    const engine = new GuiIdentityEngine({
        registry: new GuiRegistry(migrated),
        titleMatcher: new TitleMatcher(),
        layoutMatcher: new LayoutMatcher(),
        fingerprintMatcher: { match: () => false },
        config: identityConfig
    });
    const nbtTitle = text => ({ type: 'compound', value: { color: { type: 'string', value: 'black' }, text: { type: 'string', value: text } } });
    const storageTitle = {
        type: 'compound', value: {
            extra: { type: 'list', value: { type: 'compound', value: [
                { color: { type: 'string', value: 'black' }, text: { type: 'string', value: 'ᴋʜᴏ ᴄʜứᴀ ' } },
                { color: { type: 'string', value: 'yellow' }, text: { type: 'string', value: '▮▮▮▮▮▮' } },
                { color: { type: 'string', value: 'dark_gray' }, text: { type: 'string', value: '▯▯' } }
            ] } },
            text: { type: 'string', value: '' }
        }
    };
    const storage = engine.identify({ title: storageTitle, type: 'minecraft:generic_9x6', slots: Array(90).fill(null) });
    const pv2 = engine.identify({ title: nbtTitle('ᴋʜᴏ đồ #2'), type: 'minecraft:generic_9x6', slots: Array(90).fill(null) });

    assert.equal(storage.id, 'storage');
    assert.ok(storage.confidence >= identityConfig.minimumConfidence);
    assert.equal(pv2.id, 'personalVault2');
    assert.ok(pv2.confidence >= identityConfig.minimumConfidence);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('RuntimeConfigMigrator promotes the historical forced B5 allowSmelting=false default for 2.6.3', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-b5-smelting-migration-'));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    await fsp.mkdir(path.join(templateRoot, 'config', 'modes'), { recursive: true });
    await fsp.mkdir(path.join(runtimeRoot, 'config', 'modes'), { recursive: true });
    const defaults = {
        enabled: true,
        storageProtection: {
            startupTrimToReserve: false,
            startupReserveCoverage: 1.5,
            requireReliefBeforeCraft: false,
            allowSmelting: true
        }
    };
    const legacy = JSON.parse(JSON.stringify(defaults));
    legacy.storageProtection.allowSmelting = false;
    await fsp.writeFile(path.join(templateRoot, 'config', 'modes', 'b5-craft.json'), JSON.stringify(defaults, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'modes', 'b5-craft.json'), JSON.stringify(legacy, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), JSON.stringify({ appVersion: '2.6.2' }));

    const report = await new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.3' }).prepare();
    const migrated = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'modes', 'b5-craft.json'), 'utf8'));
    assert.equal(migrated.storageProtection.allowSmelting, true);
    assert.deepEqual(report.versionMigrations, ['2.6.3-b5-smelt-before-storage-protection']);
    assert.deepEqual(report.migratedFiles, ['config/modes/b5-craft.json']);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('RuntimeConfigMigrator 2.6.4 removes stone smelting and upgrades the historical /ks minerals regex', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-264-policy-migration-'));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    await fsp.mkdir(path.join(templateRoot, 'config', 'gui'), { recursive: true });
    await fsp.mkdir(path.join(templateRoot, 'config', 'smelting'), { recursive: true });
    await fsp.mkdir(path.join(templateRoot, 'config', 'minerals'), { recursive: true });
    await fsp.mkdir(path.join(runtimeRoot, 'config', 'gui'), { recursive: true });
    await fsp.mkdir(path.join(runtimeRoot, 'config', 'smelting'), { recursive: true });
    await fsp.mkdir(path.join(runtimeRoot, 'config', 'minerals'), { recursive: true });

    const windowsDefaults = {
        minerals: { title: { regex: 'ᴋʜᴏáɴɢ\\s*ѕảɴ|khoáng|khoang|mineral|ks' }, layout: {} }
    };
    const windowsLegacy = {
        minerals: { title: { regex: 'khoáng|khoang|mineral|ks' }, layout: {} }
    };
    const smeltingLegacy = {
        recipes: {
            stone_to_smooth_stone: { input: 'stone', output: 'smooth_stone', menuItemId: 'smelt_stone' },
            raw_iron_to_iron: { input: 'raw_iron', output: 'iron_ingot', menuItemId: 'smelt_iron' },
            raw_gold_to_gold: { input: 'raw_gold', output: 'gold_ingot', menuItemId: 'smelt_gold' }
        }
    };
    const conversionsLegacy = {
        smeltingRecipeIds: ['stone_to_smooth_stone', 'raw_iron_to_iron', 'raw_gold_to_gold']
    };

    await fsp.writeFile(path.join(templateRoot, 'config', 'gui', 'windows.json'), JSON.stringify(windowsDefaults, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'gui', 'windows.json'), JSON.stringify(windowsLegacy, null, 2));
    await fsp.writeFile(path.join(templateRoot, 'config', 'smelting', 'recipes.json'), JSON.stringify({ recipes: { raw_iron_to_iron: smeltingLegacy.recipes.raw_iron_to_iron, raw_gold_to_gold: smeltingLegacy.recipes.raw_gold_to_gold } }, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'smelting', 'recipes.json'), JSON.stringify(smeltingLegacy, null, 2));
    await fsp.writeFile(path.join(templateRoot, 'config', 'minerals', 'conversions.json'), JSON.stringify({ smeltingRecipeIds: ['raw_iron_to_iron', 'raw_gold_to_gold'] }, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'minerals', 'conversions.json'), JSON.stringify(conversionsLegacy, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), JSON.stringify({ appVersion: '2.6.3' }));

    const report = await new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.4' }).prepare();
    const windows = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'gui', 'windows.json'), 'utf8'));
    const smelting = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'smelting', 'recipes.json'), 'utf8'));
    const conversions = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'minerals', 'conversions.json'), 'utf8'));

    assert.equal(windows.minerals.title.regex, windowsDefaults.minerals.title.regex);
    assert.equal(smelting.recipes.stone_to_smooth_stone, undefined);
    assert.ok(smelting.recipes.raw_iron_to_iron);
    assert.ok(smelting.recipes.raw_gold_to_gold);
    assert.deepEqual(conversions.smeltingRecipeIds, ['raw_iron_to_iron', 'raw_gold_to_gold']);
    assert.ok(report.versionMigrations.includes('2.6.4-iron-gold-only-smelting-ks-identity'));
    assert.ok(report.migratedFiles.includes('config/gui/windows.json'));
    assert.ok(report.migratedFiles.includes('config/smelting/recipes.json'));
    assert.ok(report.migratedFiles.includes('config/minerals/conversions.json'));
    fs.rmSync(dir, { recursive: true, force: true });
});


test('RuntimeConfigMigrator 2.6.5 promotes historical 1.5/1.75 reserve defaults and enables guarded B2 ALL', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-265-policy-migration-'));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    for (const root of [templateRoot, runtimeRoot]) {
        await fsp.mkdir(path.join(root, 'config', 'storage'), { recursive: true });
        await fsp.mkdir(path.join(root, 'config', 'server-data'), { recursive: true });
        await fsp.mkdir(path.join(root, 'config', 'modes'), { recursive: true });
    }
    const storageDefault = { sell: { startupReserveCoverage: 3, startupStopCoverage: 3.25 } };
    const storageLegacy = { sell: { startupReserveCoverage: 1.5, startupStopCoverage: 1.75 } };
    const b5Default = { quantityOptimization: { useAllForB2: true, b2BatchSize: 64 } };
    const b5Legacy = { quantityOptimization: { useAllForB2: false, b2BatchSize: 64 } };
    const modeDefault = { storageProtection: { startupReserveCoverage: 3 } };
    const modeLegacy = { storageProtection: { startupReserveCoverage: 1.5 } };
    await fsp.writeFile(path.join(templateRoot, 'config', 'storage', 'kho.json'), JSON.stringify(storageDefault, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'storage', 'kho.json'), JSON.stringify(storageLegacy, null, 2));
    await fsp.writeFile(path.join(templateRoot, 'config', 'server-data', 'b5.json'), JSON.stringify(b5Default, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'server-data', 'b5.json'), JSON.stringify(b5Legacy, null, 2));
    await fsp.writeFile(path.join(templateRoot, 'config', 'modes', 'b5-craft.json'), JSON.stringify(modeDefault, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'modes', 'b5-craft.json'), JSON.stringify(modeLegacy, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), JSON.stringify({ appVersion: '2.6.4' }));

    const report = await new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.5' }).prepare();
    const storage = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'storage', 'kho.json'), 'utf8'));
    const b5 = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'server-data', 'b5.json'), 'utf8'));
    const mode = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'modes', 'b5-craft.json'), 'utf8'));
    assert.equal(storage.sell.startupReserveCoverage, 3);
    assert.equal(storage.sell.startupStopCoverage, 3.25);
    assert.equal(b5.quantityOptimization.useAllForB2, true);
    assert.equal(mode.storageProtection.startupReserveCoverage, 3);
    assert.ok(report.versionMigrations.includes('2.6.5-gui-normalization-storage-race-b2-all'));
    assert.ok(report.migratedFiles.includes('config/storage/kho.json'));
    assert.ok(report.migratedFiles.includes('config/server-data/b5.json'));
    assert.ok(report.migratedFiles.includes('config/modes/b5-craft.json'));
    fs.rmSync(dir, { recursive: true, force: true });
});

test('RuntimeConfigMigrator 2.6.5 preserves non-historical custom reserve values', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-265-custom-policy-'));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    await fsp.mkdir(path.join(templateRoot, 'config', 'storage'), { recursive: true });
    await fsp.mkdir(path.join(runtimeRoot, 'config', 'storage'), { recursive: true });
    await fsp.writeFile(path.join(templateRoot, 'config', 'storage', 'kho.json'), JSON.stringify({ sell: { startupReserveCoverage: 3, startupStopCoverage: 3.25 } }, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'storage', 'kho.json'), JSON.stringify({ sell: { startupReserveCoverage: 4, startupStopCoverage: 4.5 } }, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), JSON.stringify({ appVersion: '2.6.4' }));

    await new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.5' }).prepare();
    const storage = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'storage', 'kho.json'), 'utf8'));
    assert.equal(storage.sell.startupReserveCoverage, 4);
    assert.equal(storage.sell.startupStopCoverage, 4.5);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('RuntimeConfigMigrator 2.6.8 adds craft reconciliation defaults and tungsten learn-once policy without overwriting fixed identity', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-268-hardening-migration-'));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    for (const root of [templateRoot, runtimeRoot]) {
        await fsp.mkdir(path.join(root, 'config', 'modes'), { recursive: true });
        await fsp.mkdir(path.join(root, 'config', 'items'), { recursive: true });
    }
    const modeDefaults = {
        reconciliation: {
            maxFreshReads: 3,
            retryMs: 1000,
            unresolvedPollMs: 15000,
            allowRetryAfterVerifiedNoEffect: true
        }
    };
    const itemsDefaults = {
        tungsten: {
            metadata: { strongIdentityPolicy: 'learn' },
            representations: { default: { rules: [{ type: 'name', value: 'Tungsten' }] } }
        }
    };
    await fsp.writeFile(path.join(templateRoot, 'config', 'modes', 'b5-craft.json'), JSON.stringify(modeDefaults, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'modes', 'b5-craft.json'), JSON.stringify({}, null, 2));
    await fsp.writeFile(path.join(templateRoot, 'config', 'items', 'items.json'), JSON.stringify(itemsDefaults, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'items', 'items.json'), JSON.stringify({ tungsten: { representations: { default: { rules: [{ type: 'name', value: 'Tungsten' }] } } } }, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), JSON.stringify({ appVersion: '2.6.7' }));

    const report = await new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.8' }).prepare();
    const mode = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'modes', 'b5-craft.json'), 'utf8'));
    const items = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'items', 'items.json'), 'utf8'));
    assert.deepEqual(mode.reconciliation, modeDefaults.reconciliation);
    assert.equal(items.tungsten.metadata.strongIdentityPolicy, 'learn');
    assert.ok(report.filesMerged >= 2, 'generic default merge should add the new safe fields');

    const fixedRuntime = path.join(dir, 'runtime-fixed');
    await fsp.mkdir(path.join(fixedRuntime, 'config', 'modes'), { recursive: true });
    await fsp.mkdir(path.join(fixedRuntime, 'config', 'items'), { recursive: true });
    await fsp.writeFile(path.join(fixedRuntime, 'config', 'modes', 'b5-craft.json'), JSON.stringify({ reconciliation: { enabled: false, maxFreshReads: 9 } }, null, 2));
    await fsp.writeFile(path.join(fixedRuntime, 'config', 'items', 'items.json'), JSON.stringify({
        tungsten: {
            representations: {
                default: { rules: [{ type: 'name', value: 'Tungsten' }] },
                inventory: { rules: [{ type: 'identity', value: 'MMOITEMS_ITEM_ID:KNOWN_TUNGSTEN' }] },
                'personal-vault': { rules: [{ type: 'identity', value: 'MMOITEMS_ITEM_ID:KNOWN_TUNGSTEN' }] }
            }
        }
    }, null, 2));
    await fsp.writeFile(path.join(fixedRuntime, '.mcbot-runtime.json'), JSON.stringify({ appVersion: '2.6.7' }));
    await new RuntimeConfigMigrator({ templateRoot, runtimeRoot: fixedRuntime, appVersion: '2.6.8' }).prepare();
    const fixedMode = JSON.parse(await fsp.readFile(path.join(fixedRuntime, 'config', 'modes', 'b5-craft.json'), 'utf8'));
    const fixedItems = JSON.parse(await fsp.readFile(path.join(fixedRuntime, 'config', 'items', 'items.json'), 'utf8'));
    assert.equal(fixedMode.reconciliation.enabled, undefined, 'reconciliation barrier cannot be disabled');
    assert.equal(fixedMode.reconciliation.maxFreshReads, 9);
    assert.equal(fixedMode.reconciliation.retryMs, 1000, 'missing reconciliation keys should be added');
    assert.equal(fixedItems.tungsten.metadata, undefined, 'fixed operator identity must not be replaced by learn policy');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('RuntimeConfigMigrator 2.6.10 upgrades historical HUB/SKY retry defaults and B5 normalization without overwriting custom Sky policy', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-2610-hub-sky-'));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    for (const root of [templateRoot, runtimeRoot]) {
        for (const sub of ['modes', 'personal-vault', 'skyblock', 'minerals', 'bots']) {
            await fsp.mkdir(path.join(root, 'config', sub), { recursive: true });
        }
    }
    const modeDefault = { b1NormalizeIntervalMs: 30000, postB5CooldownMs: 1800000 };
    const pvDefault = { openAttempts: 3, openAfterCloseSettleMs: 1000, openCloseConfirmTimeoutMs: 1000 };
    const skyDefault = {
        selections: { sky1: { slot: 11 }, sky2: { slot: 13 }, primary: { slot: 11 }, secondary: { slot: 13 } },
        defaultSelection: 'sky1',
        autoJoin: { selection: 'sky1', maxAttempts: 0, retryDelayMs: 300000, rejoinDelayMs: 300000, recoveryPollMs: 10000 }
    };
    const conversionsDefault = { menuOptionReadyTimeoutMs: 1500 };
    const mineralsDefault = { conversionGuiId: 'mineralConversion' };
    await fsp.writeFile(path.join(templateRoot, 'config', 'modes', 'b5-craft.json'), JSON.stringify(modeDefault));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'modes', 'b5-craft.json'), JSON.stringify({}));
    await fsp.writeFile(path.join(templateRoot, 'config', 'personal-vault', 'pv2.json'), JSON.stringify(pvDefault));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'personal-vault', 'pv2.json'), JSON.stringify({ openAttempts: 2 }));
    await fsp.writeFile(path.join(templateRoot, 'config', 'skyblock', 'join.json'), JSON.stringify(skyDefault));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'skyblock', 'join.json'), JSON.stringify({ selections: { primary: { slot: 11 }, secondary: { slot: 13 } }, defaultSelection: 'primary', autoJoin: { selection: 'primary', maxAttempts: 3, retryDelayMs: 2000 } }));
    await fsp.writeFile(path.join(templateRoot, 'config', 'minerals', 'conversions.json'), JSON.stringify(conversionsDefault));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'minerals', 'conversions.json'), JSON.stringify({}));
    await fsp.writeFile(path.join(templateRoot, 'config', 'minerals', 'menu.json'), JSON.stringify(mineralsDefault));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'minerals', 'menu.json'), JSON.stringify({}));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'bots', 'bot-01.json'), JSON.stringify({ id: 'bot-01', enabled: true, username: 'worker' }));
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), JSON.stringify({ appVersion: '2.6.9' }));

    const report = await new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.10' }).prepare();
    const mode = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'modes', 'b5-craft.json')));
    const pv = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'personal-vault', 'pv2.json')));
    const sky = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'skyblock', 'join.json')));
    const bot = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'bots', 'bot-01.json')));
    assert.equal(mode.b1NormalizeIntervalMs, 30000);
    assert.equal(mode.postB5CooldownMs, 1800000);
    assert.equal(pv.openAttempts, 3);
    assert.equal(sky.defaultSelection, 'sky1');
    assert.equal(sky.autoJoin.selection, 'sky1');
    assert.equal(sky.autoJoin.maxAttempts, 0);
    assert.equal(sky.autoJoin.retryDelayMs, 300000);
    assert.equal(sky.autoJoin.rejoinDelayMs, 300000);
    assert.equal(bot.skyblockSelection, 'sky1');
    assert.ok(report.versionMigrations.includes('2.6.10-hub-sky-recovery-b5-normalization'));

    const customRoot = path.join(dir, 'runtime-custom');
    await fsp.mkdir(path.join(customRoot, 'config', 'skyblock'), { recursive: true });
    await fsp.writeFile(path.join(customRoot, 'config', 'skyblock', 'join.json'), JSON.stringify({ selections: { custom: { slot: 15 } }, defaultSelection: 'custom', autoJoin: { selection: 'custom', maxAttempts: 7, retryDelayMs: 12345 } }));
    await fsp.writeFile(path.join(customRoot, '.mcbot-runtime.json'), JSON.stringify({ appVersion: '2.6.9' }));
    await new RuntimeConfigMigrator({ templateRoot, runtimeRoot: customRoot, appVersion: '2.6.10' }).prepare();
    const custom = JSON.parse(await fsp.readFile(path.join(customRoot, 'config', 'skyblock', 'join.json')));
    assert.equal(custom.autoJoin.selection, 'custom');
    assert.equal(custom.autoJoin.maxAttempts, 7);
    assert.equal(custom.autoJoin.retryDelayMs, 12345);
    fs.rmSync(dir, { recursive: true, force: true });
});


test('RuntimeConfigMigrator never applies migrations newer than the target appVersion', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-migration-target-gate-'));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    await fsp.mkdir(path.join(templateRoot, 'config', 'modes'), { recursive: true });
    await fsp.mkdir(path.join(runtimeRoot, 'config', 'modes'), { recursive: true });
    const mode = { storageProtection: { startupTrimToReserve: false, startupReserveCoverage: 3, allowSmelting: true, enabled: true, requireReliefBeforeCraft: false } };
    await fsp.writeFile(path.join(templateRoot, 'config', 'modes', 'b5-craft.json'), JSON.stringify(mode, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'modes', 'b5-craft.json'), JSON.stringify(mode, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), JSON.stringify({ appVersion: '2.6.4' }));

    await new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.5' }).prepare();
    const migrated = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'modes', 'b5-craft.json'), 'utf8'));
    assert.equal(migrated.storageProtection.startupTrimToReserve, false, '2.6.11 field-removal migration must not run for a 2.6.5 target');
    assert.equal(migrated.storageProtection.startupReserveCoverage, 3);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('RuntimeConfigMigrator 2.6.11 consolidates startup protection and fixes live-observed tungsten identity', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-2611-single-owner-'));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    for (const root of [templateRoot, runtimeRoot]) {
        await fsp.mkdir(path.join(root, 'config', 'modes'), { recursive: true });
        await fsp.mkdir(path.join(root, 'config', 'storage'), { recursive: true });
        await fsp.mkdir(path.join(root, 'config', 'items'), { recursive: true });
    }
    const modeDefault = { storageProtection: { enabled: true, requireReliefBeforeCraft: false, allowSmelting: true } };
    const modeLegacy = { storageProtection: { enabled: true, startupTrimToReserve: false, startupReserveCoverage: 4.25, requireReliefBeforeCraft: false, allowSmelting: true } };
    const storageDefault = { sell: { startupTrimEnabled: true, startupReserveCoverage: 3, startupStopCoverage: 3.25 } };
    const itemsDefault = {
        tungsten: {
            representations: {
                default: { rules: [{ type: 'name', value: 'Tungsten' }] },
                inventory: { rules: [{ type: 'identity', value: 'MMOITEMS_ITEM_ID:VOLFRAM' }] },
                'personal-vault': { rules: [{ type: 'identity', value: 'MMOITEMS_ITEM_ID:VOLFRAM' }] }
            }
        }
    };
    const itemsLegacy = {
        tungsten: {
            metadata: { strongIdentityPolicy: 'learn' },
            representations: { default: { rules: [{ type: 'name', value: 'Tungsten' }] } }
        }
    };
    await fsp.writeFile(path.join(templateRoot, 'config', 'modes', 'b5-craft.json'), JSON.stringify(modeDefault, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'modes', 'b5-craft.json'), JSON.stringify(modeLegacy, null, 2));
    await fsp.writeFile(path.join(templateRoot, 'config', 'storage', 'kho.json'), JSON.stringify(storageDefault, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'storage', 'kho.json'), JSON.stringify(storageDefault, null, 2));
    await fsp.writeFile(path.join(templateRoot, 'config', 'items', 'items.json'), JSON.stringify(itemsDefault, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'items', 'items.json'), JSON.stringify(itemsLegacy, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), JSON.stringify({ appVersion: '2.6.10' }));

    const report = await new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.11' }).prepare();
    const mode = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'modes', 'b5-craft.json'), 'utf8'));
    const storage = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'storage', 'kho.json'), 'utf8'));
    const items = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'items', 'items.json'), 'utf8'));

    assert.equal(mode.storageProtection.startupTrimToReserve, undefined);
    assert.equal(mode.storageProtection.startupReserveCoverage, undefined);
    assert.equal(storage.sell.startupTrimEnabled, true, 'storage policy remains the single startup-trim owner');
    assert.equal(storage.sell.startupReserveCoverage, 4.25, 'non-default legacy B5 reserve is preserved by moving it to storage');
    assert.equal(items.tungsten.metadata, undefined);
    assert.equal(items.tungsten.representations.inventory.rules[0].value, 'MMOITEMS_ITEM_ID:VOLFRAM');
    assert.equal(items.tungsten.representations['personal-vault'].rules[0].value, 'MMOITEMS_ITEM_ID:VOLFRAM');
    assert.ok(report.versionMigrations.includes('2.6.11-single-source-storage-volfram-identity'));

    const customRoot = path.join(dir, 'runtime-custom');
    for (const sub of ['modes', 'storage', 'items']) await fsp.mkdir(path.join(customRoot, 'config', sub), { recursive: true });
    await fsp.writeFile(path.join(customRoot, 'config', 'modes', 'b5-craft.json'), JSON.stringify(modeLegacy, null, 2));
    await fsp.writeFile(path.join(customRoot, 'config', 'storage', 'kho.json'), JSON.stringify({ sell: { startupTrimEnabled: false, startupReserveCoverage: 5, startupStopCoverage: 5.25 } }, null, 2));
    await fsp.writeFile(path.join(customRoot, 'config', 'items', 'items.json'), JSON.stringify({
        tungsten: {
            metadata: { strongIdentityPolicy: 'learn' },
            representations: {
                default: { rules: [{ type: 'name', value: 'Tungsten' }] },
                inventory: { rules: [{ type: 'identity', value: 'MMOITEMS_ITEM_ID:CUSTOM_VOLFRAM' }] },
                'personal-vault': { rules: [{ type: 'identity', value: 'MMOITEMS_ITEM_ID:CUSTOM_VOLFRAM' }] }
            }
        }
    }, null, 2));
    await fsp.writeFile(path.join(customRoot, '.mcbot-runtime.json'), JSON.stringify({ appVersion: '2.6.10' }));
    await new RuntimeConfigMigrator({ templateRoot, runtimeRoot: customRoot, appVersion: '2.6.11' }).prepare();
    const customStorage = JSON.parse(await fsp.readFile(path.join(customRoot, 'config', 'storage', 'kho.json'), 'utf8'));
    const customItems = JSON.parse(await fsp.readFile(path.join(customRoot, 'config', 'items', 'items.json'), 'utf8'));
    assert.equal(customStorage.sell.startupTrimEnabled, false);
    assert.equal(customStorage.sell.startupReserveCoverage, 5);
    assert.equal(customItems.tungsten.representations.inventory.rules[0].value, 'MMOITEMS_ITEM_ID:CUSTOM_VOLFRAM');
    assert.equal(customItems.tungsten.metadata, undefined, 'fixed operator identity wins over legacy learn policy');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('RuntimeConfigMigrator 2.6.14 enables Discord remote-only defaults and strengthens MinerUA smelting identity without overwriting custom regexes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-2614-remote-'));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    for (const root of [templateRoot, runtimeRoot]) {
        await fsp.mkdir(path.join(root, 'config', 'discord'), { recursive: true });
        await fsp.mkdir(path.join(root, 'config', 'gui'), { recursive: true });
    }
    const discordDefault = { enabled: true, remoteOnly: true, skyCommandName: 'skycmd' };
    const windowsDefault = {
        minerals: { title: { regex: '^ᴋʜᴏáɴɢ\\s*ѕảɴ$|^khoang\\s*san$|^minerals?$|^ks$' }, layout: {} },
        smelting: { title: { regex: '^ɴᴜɴɢ\\s*ᴋʜᴏáɴɢ\\s*ѕảɴ$|^nung(?:\\s+khoang\\s+san)?$|^smelt(?:ing)?$' }, layout: {} }
    };
    await fsp.writeFile(path.join(templateRoot, 'config', 'discord', 'discord.json'), JSON.stringify(discordDefault, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'discord', 'discord.json'), JSON.stringify({ enabled: true }, null, 2));
    await fsp.writeFile(path.join(templateRoot, 'config', 'gui', 'windows.json'), JSON.stringify(windowsDefault, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'gui', 'windows.json'), JSON.stringify({ minerals: { title: { regex: 'ᴋʜᴏáɴɢ\\s*ѕảɴ|khoáng|khoang|mineral|ks' }, layout: {} }, smelting: { title: { regex: 'nung|smelt' }, layout: {} } }, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), JSON.stringify({ appVersion: '2.6.13' }));

    const report = await new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.14' }).prepare();
    const discord = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'discord', 'discord.json'), 'utf8'));
    const windows = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'gui', 'windows.json'), 'utf8'));
    assert.equal(discord.remoteOnly, true);
    assert.equal(discord.skyCommandName, 'skycmd');
    assert.equal(windows.minerals.title.regex, windowsDefault.minerals.title.regex);
    assert.equal(windows.smelting.title.regex, windowsDefault.smelting.title.regex);
    assert.ok(report.versionMigrations.includes('2.6.14-discord-remote-strong-smelting-identity'));

    const customRoot = path.join(dir, 'custom');
    await fsp.mkdir(path.join(customRoot, 'config', 'discord'), { recursive: true });
    await fsp.mkdir(path.join(customRoot, 'config', 'gui'), { recursive: true });
    await fsp.writeFile(path.join(customRoot, 'config', 'discord', 'discord.json'), JSON.stringify({ enabled: true, remoteOnly: false, skyCommandName: 'remote' }, null, 2));
    await fsp.writeFile(path.join(customRoot, 'config', 'gui', 'windows.json'), JSON.stringify({ minerals: { title: { regex: 'CUSTOM_MINERALS' } }, smelting: { title: { regex: 'CUSTOM_SMELT' } } }, null, 2));
    await fsp.writeFile(path.join(customRoot, '.mcbot-runtime.json'), JSON.stringify({ appVersion: '2.6.13' }));
    await new RuntimeConfigMigrator({ templateRoot, runtimeRoot: customRoot, appVersion: '2.6.14' }).prepare();
    const customDiscord = JSON.parse(await fsp.readFile(path.join(customRoot, 'config', 'discord', 'discord.json'), 'utf8'));
    const customWindows = JSON.parse(await fsp.readFile(path.join(customRoot, 'config', 'gui', 'windows.json'), 'utf8'));
    assert.equal(customDiscord.remoteOnly, false);
    assert.equal(customDiscord.skyCommandName, 'remote');
    assert.equal(customWindows.minerals.title.regex, 'CUSTOM_MINERALS');
    assert.equal(customWindows.smelting.title.regex, 'CUSTOM_SMELT');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('RuntimeConfigMigrator 2.6.16 replaces pressure tuning and autoJoin with B5 batch protection and mode-driven Sky gateway', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-2616-storage-sky-'));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    for (const root of [templateRoot, runtimeRoot]) {
        for (const sub of ['minerals', 'storage', 'modes', 'skyblock']) {
            await fsp.mkdir(path.join(root, 'config', sub), { recursive: true });
        }
    }

    const files = {
        'minerals/conversions.json': {
            smeltingRecipeIds: ['raw_gold_to_gold', 'cobblestone_to_stone', 'raw_iron_to_iron'],
            storagePressure: { decompressionMaxRatio: 0.73, requireKnownCapacityForDecompression: false, highRatio: 0.9, lowWaterRatio: 0.7 }
        },
        'storage/kho.json': { sell: { enabled: true, commandKey: 'sell', mode: 'gui', resultDelayMs: 100, itemAliases: {}, allowAll: false, allowSingle: false, blockOnly: true, openSettleMs: 777, reserveCoverage: 3, maxProtectionPasses: 9, maxSellBurstClicks: 8, forecastWindowMs: 60000, startupReserveCoverage: 3, fastDisposable: ['cobblestone'] } },
        'modes/b5-craft.json': { waitForSkyblockReady: true, skyblockReadyTimeoutMs: 30000, b1NormalizeIntervalMs: 5000, storageProtection: { enabled: true } },
        'modes/collector-b5.json': { waitForSkyblockReady: true, skyblockReadyTimeoutMs: 30000, storageProtection: { enabled: true } },
        'skyblock/join.json': { defaultSelection: 'sky1', selections: { sky1: { targetServer: 'sky1' }, sky2: { targetServer: 'sky2' } }, autoJoin: { enabled: true, selection: 'sky2', delayMs: 1200, spawnFallbackDelayMs: 5000, retryDelayMs: 2000, rejoinDelayMs: 2500, recoveryPollMs: 9000, waitForResourcePack: true, maxAttempts: 3 } }
    };
    for (const [relative, value] of Object.entries(files)) {
        const runtimePath = path.join(runtimeRoot, 'config', relative);
        const templatePath = path.join(templateRoot, 'config', relative);
        await fsp.mkdir(path.dirname(runtimePath), { recursive: true });
        await fsp.mkdir(path.dirname(templatePath), { recursive: true });
        await fsp.writeFile(runtimePath, JSON.stringify(value, null, 2));
        await fsp.writeFile(templatePath, JSON.stringify(value, null, 2));
    }
    // The runtime starts at the historical 2.6.15 contract while the template
    // represents the installed 2.6.16 defaults. A second prepare must therefore
    // not resurrect fields that the migration intentionally removed.
    const currentTemplates = {
        'minerals/conversions.json': { smeltingRecipeIds: ['raw_iron_to_iron', 'raw_gold_to_gold'] },
        'storage/kho.json': { sell: { enabled: true, commandKey: 'sell', mode: 'gui', resultDelayMs: 100, itemAliases: {}, allowAll: false, allowSingle: true, blockOnly: true, reserveCoverage: 1.5 } },
        'modes/b5-craft.json': { enabled: true },
        'modes/collector-b5.json': { b1Decompression: { maxUsageRatio: 0.8, requireKnownCapacity: true } },
        'skyblock/join.json': { defaultSelection: 'sky1', selections: { sky1: { targetServer: 'sky1' }, sky2: { targetServer: 'sky2' } }, modeJoin: { delayMs: 1200, spawnFallbackDelayMs: 5000, retryDelayMs: 300000, rejoinDelayMs: 300000, recoveryPollMs: 10000, waitForResourcePack: false } }
    };
    for (const [relative, value] of Object.entries(currentTemplates)) {
        await fsp.writeFile(path.join(templateRoot, 'config', relative), JSON.stringify(value, null, 2));
    }
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), JSON.stringify({ appVersion: '2.6.15' }));

    const report = await new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.16' }).prepare();
    const read = async relative => JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', relative), 'utf8'));
    const conversions = await read('minerals/conversions.json');
    const storage = await read('storage/kho.json');
    const b5 = await read('modes/b5-craft.json');
    const collector = await read('modes/collector-b5.json');
    const sky = await read('skyblock/join.json');

    assert.equal(conversions.storagePressure, undefined);
    assert.deepEqual(conversions.smeltingRecipeIds, ['raw_iron_to_iron', 'raw_gold_to_gold']);
    assert.equal(storage.sell.reserveCoverage, 1.5);
    assert.equal(storage.sell.allowSingle, false, 'operator allowSingle:false must survive migration');
    assert.equal(storage.sell.openSettleMs, 777, 'schema-supported operator fields must be preserved');
    for (const key of ['maxProtectionPasses', 'maxSellBurstClicks', 'forecastWindowMs', 'startupReserveCoverage', 'fastDisposable']) assert.equal(storage.sell[key], undefined);
    assert.equal(b5.waitForSkyblockReady, undefined);
    assert.equal(b5.skyblockReadyTimeoutMs, undefined);
    assert.equal(b5.b1NormalizeIntervalMs, undefined);
    assert.equal(b5.storageProtection, undefined);
    assert.deepEqual(collector.b1Decompression, { maxUsageRatio: 0.73, requireKnownCapacity: false });
    assert.equal(collector.storageProtection, undefined);
    assert.equal(sky.autoJoin, undefined);
    assert.equal(sky.defaultSelection, 'sky2');
    assert.equal(sky.modeJoin.retryDelayMs, 2000);
    assert.equal(sky.modeJoin.rejoinDelayMs, 2500);
    assert.equal(sky.modeJoin.waitForResourcePack, true);
    assert.ok(report.versionMigrations.includes('2.6.16-b5-storage-protection-mode-sky-gateway'));
    const migrationReport = report.migrationReports.find(item => item.migrationId === '2.6.16-b5-storage-protection-mode-sky-gateway');
    assert.ok(migrationReport);
    assert.ok(migrationReport.changes.some(change => change.field === 'sell.reserveCoverage' && change.action === 'normalized-hard-b5-reserve'));
    assert.ok(migrationReport.changes.some(change => change.field === 'smeltingRecipeIds' && change.action === 'canonicalized-b5-ordered-smelting-contract'));
    assert.ok(migrationReport.changes.some(change => change.field === 'sell.maxProtectionPasses' && change.action === 'removed-unsupported-legacy-field'));

    const beforeSecondPrepare = await fsp.readFile(path.join(runtimeRoot, 'config', 'storage', 'kho.json'), 'utf8');
    const secondReport = await new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.16' }).prepare();
    const afterSecondPrepare = await fsp.readFile(path.join(runtimeRoot, 'config', 'storage', 'kho.json'), 'utf8');
    assert.equal(afterSecondPrepare, beforeSecondPrepare, 'migration must be idempotent after metadata reaches 2.6.16');
    assert.equal(secondReport.versionMigrations.length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('RuntimeConfigMigrator 2.6.26 enforces the B5 64-only sell policy without overwriting other storage settings', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-2626-sell64-'));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    for (const root of [templateRoot, runtimeRoot]) {
        await fsp.mkdir(path.join(root, 'config', 'storage'), { recursive: true });
    }
    const template = {
        sell: {
            enabled: true,
            reserveCoverage: 1.5,
            allowSingle: false,
            openSettleMs: 200
        }
    };
    const runtime = {
        sell: {
            enabled: false,
            reserveCoverage: 1.5,
            allowSingle: true,
            openSettleMs: 777
        }
    };
    await fsp.writeFile(path.join(templateRoot, 'config', 'storage', 'kho.json'), JSON.stringify(template, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'storage', 'kho.json'), JSON.stringify(runtime, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), JSON.stringify({ appVersion: '2.6.25' }));

    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.26' });
    const report = await migrator.prepare();
    const migratedPath = path.join(runtimeRoot, 'config', 'storage', 'kho.json');
    const migrated = JSON.parse(await fsp.readFile(migratedPath, 'utf8'));
    assert.equal(migrated.sell.allowSingle, false);
    assert.equal(migrated.sell.enabled, false);
    assert.equal(migrated.sell.openSettleMs, 777);
    assert.ok(report.versionMigrations.includes('2.6.26-b5-64-only-resumable-storage-sale'));
    const migrationReport = report.migrationReports.find(item =>
        item.migrationId === '2.6.26-b5-64-only-resumable-storage-sale');
    assert.ok(migrationReport?.changes.some(change =>
        change.field === 'sell.allowSingle'
        && change.action === 'enforced-b5-64-only-sell-contract'
        && change.previous === true
        && change.next === false));

    const beforeSecond = await fsp.readFile(migratedPath, 'utf8');
    const second = await migrator.prepare();
    assert.equal(await fsp.readFile(migratedPath, 'utf8'), beforeSecond);
    assert.equal(second.versionMigrations.length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('RuntimeConfigMigrator migration failure rolls config back and does not advance appVersion', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-migration-rollback-'));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    await fsp.mkdir(path.join(templateRoot, 'config', 'storage'), { recursive: true });
    await fsp.mkdir(path.join(runtimeRoot, 'config', 'storage'), { recursive: true });

    const defaults = { sell: { enabled: true, reserveCoverage: 1.5, allowSingle: true, openSettleMs: 200 } };
    const original = { sell: { enabled: false, reserveCoverage: 3, allowSingle: false } };
    await fsp.writeFile(path.join(templateRoot, 'config', 'storage', 'kho.json'), JSON.stringify(defaults, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'storage', 'kho.json'), JSON.stringify(original, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), JSON.stringify({ appVersion: '2.6.15' }));

    const migrator = new RuntimeConfigMigrator({
        templateRoot,
        runtimeRoot,
        appVersion: '2.6.16',
        migrationRunner: async () => { throw new Error('synthetic migration failure'); }
    });
    await assert.rejects(() => migrator.prepare(), error => {
        assert.equal(error?.details?.metadataAdvanced, false);
        assert.equal(error?.details?.rollback?.success, true);
        assert.equal(error?.details?.rollback?.success, true);
        return true;
    });

    const metadataAfterFailure = JSON.parse(await fsp.readFile(path.join(runtimeRoot, '.mcbot-runtime.json'), 'utf8'));
    const configAfterFailure = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'storage', 'kho.json'), 'utf8'));
    assert.equal(metadataAfterFailure.appVersion, '2.6.15');
    assert.deepEqual(configAfterFailure, original, 'failed prepare must restore the exact pre-migration config');

    const retry = new RuntimeConfigMigrator({
        templateRoot,
        runtimeRoot,
        appVersion: '2.6.16',
        migrationRunner: async () => ({ applied: ['retry-ok'], files: [], reports: [] })
    });
    const retryReport = await retry.prepare();
    const metadataAfterRetry = JSON.parse(await fsp.readFile(path.join(runtimeRoot, '.mcbot-runtime.json'), 'utf8'));
    assert.equal(metadataAfterRetry.appVersion, '2.6.16');
    assert.deepEqual(retryReport.versionMigrations, ['retry-ok']);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('RuntimeConfigMigrator same-version failure after merge restores config byte-for-byte and keeps metadata version', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-migration-same-version-'));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    await fsp.mkdir(path.join(templateRoot, 'config', 'storage'), { recursive: true });
    await fsp.mkdir(path.join(runtimeRoot, 'config', 'storage'), { recursive: true });
    const originalBytes = '{\n  "sell": { "enabled": true, "allowSingle": false }\n}\n';
    await fsp.writeFile(path.join(templateRoot, 'config', 'storage', 'kho.json'), JSON.stringify({ sell: { enabled: true, allowSingle: true, reserveCoverage: 1.5 } }, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'storage', 'kho.json'), originalBytes);
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), JSON.stringify({ appVersion: '2.6.16', marker: 'keep' }, null, 2));

    const migrator = new RuntimeConfigMigrator({
        templateRoot, runtimeRoot, appVersion: '2.6.16',
        migrationRunner: async () => { throw new Error('same-version synthetic failure after merge'); }
    });
    await assert.rejects(() => migrator.prepare(), error => {
        assert.equal(error?.code, 'RUNTIME_CONFIG_MIGRATION_FAILED');
        assert.equal(error?.details?.rollback?.success, true);
        return true;
    });
    assert.equal(await fsp.readFile(path.join(runtimeRoot, 'config', 'storage', 'kho.json'), 'utf8'), originalBytes);
    assert.deepEqual(JSON.parse(await fsp.readFile(path.join(runtimeRoot, '.mcbot-runtime.json'), 'utf8')), { appVersion: '2.6.16', marker: 'keep' });
    fs.rmSync(dir, { recursive: true, force: true });
});

test('RuntimeConfigMigrator malformed required runtime JSON aborts transaction without losing operator file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-migration-malformed-required-'));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    await fsp.mkdir(path.join(templateRoot, 'config', 'storage'), { recursive: true });
    await fsp.mkdir(path.join(runtimeRoot, 'config', 'storage'), { recursive: true });
    const malformed = '{"sell":{"enabled":false,"allowSingle":false}, BROKEN';
    await fsp.writeFile(path.join(templateRoot, 'config', 'storage', 'kho.json'), JSON.stringify({ sell: { enabled: true, reserveCoverage: 1.5 } }, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'storage', 'kho.json'), malformed);
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), JSON.stringify({ appVersion: '2.6.15' }));

    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.16' });
    await assert.rejects(() => migrator.prepare(), error => {
        assert.equal(error?.details?.metadataAdvanced, false);
        assert.equal(error?.details?.rollback?.success, true);
        return true;
    });
    assert.equal(await fsp.readFile(path.join(runtimeRoot, 'config', 'storage', 'kho.json'), 'utf8'), malformed);
    assert.equal(JSON.parse(await fsp.readFile(path.join(runtimeRoot, '.mcbot-runtime.json'), 'utf8')).appVersion, '2.6.15');
    fs.rmSync(dir, { recursive: true, force: true });
});

test('RuntimeConfigMigrator backup creation failure leaves target and metadata untouched', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-migration-backup-fail-'));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    await fsp.mkdir(path.join(templateRoot, 'config', 'storage'), { recursive: true });
    await fsp.mkdir(path.join(runtimeRoot, 'config', 'storage'), { recursive: true });
    const originalBytes = '{"sell":{"enabled":false,"allowSingle":false}}\n';
    const metadataBytes = '{"appVersion":"2.6.15","operator":"keep"}\n';
    await fsp.writeFile(path.join(templateRoot, 'config', 'storage', 'kho.json'), JSON.stringify({ sell: { enabled: true, reserveCoverage: 1.5 } }, null, 2));
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'storage', 'kho.json'), originalBytes);
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), metadataBytes);
    // Upgrade backup creation needs runtime/data/backups/...; making data a file
    // forces backup creation to fail before any config mutation can occur.
    await fsp.writeFile(path.join(runtimeRoot, 'data'), 'not-a-directory');

    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.16' });
    await assert.rejects(() => migrator.prepare(), error => {
        assert.equal(error?.details?.metadataAdvanced, false);
        assert.equal(error?.details?.rollback?.success, true);
        assert.equal(error?.details?.rollback?.targetUntouched, true);
        return true;
    });
    assert.equal(await fsp.readFile(path.join(runtimeRoot, 'config', 'storage', 'kho.json'), 'utf8'), originalBytes);
    assert.equal(await fsp.readFile(path.join(runtimeRoot, '.mcbot-runtime.json'), 'utf8'), metadataBytes);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('RuntimeConfigMigrator rejects a corrupted upgrade backup before mutation and leaves target/metadata byte-identical', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-migration-corrupt-backup-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    await fsp.mkdir(path.join(templateRoot, 'config', 'storage'), { recursive: true });
    await fsp.mkdir(path.join(runtimeRoot, 'config', 'storage'), { recursive: true });
    const configFile = path.join(runtimeRoot, 'config', 'storage', 'kho.json');
    const metadataFile = path.join(runtimeRoot, '.mcbot-runtime.json');
    const originalConfig = '{"sell":{"enabled":false,"allowSingle":false}}\n';
    const originalMetadata = '{"appVersion":"2.6.16","marker":"operator"}\n';
    await fsp.writeFile(path.join(templateRoot, 'config', 'storage', 'kho.json'), JSON.stringify({ sell: { enabled: true, reserveCoverage: 1.5 } }, null, 2));
    await fsp.writeFile(configFile, originalConfig);
    await fsp.writeFile(metadataFile, originalMetadata);

    const fsOps = Object.create(fsp);
    fsOps.cp = async (source, destination, options) => {
        await fsp.cp(source, destination, options);
        if (String(destination).includes(`${path.sep}data${path.sep}backups${path.sep}migrations${path.sep}`)) {
            await fsp.writeFile(path.join(destination, 'storage', 'kho.json'), 'CORRUPTED-BACKUP');
        }
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.17', fsOps });
    await assert.rejects(() => migrator.prepare(), error => {
        assert.equal(error?.code, 'RUNTIME_CONFIG_MIGRATION_FAILED');
        assert.equal(error?.details?.metadataAdvanced, false);
        assert.equal(error?.details?.rollback?.targetUntouched, true);
        assert.equal(error?.details?.verifiedRollbackSource, null);
        return true;
    });
    assert.equal(await fsp.readFile(configFile, 'utf8'), originalConfig);
    assert.equal(await fsp.readFile(metadataFile, 'utf8'), originalMetadata);
});

test('RuntimeConfigMigrator transient snapshot verification failure never renames or deletes active config', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-migration-corrupt-transient-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(path.join(runtimeRoot, 'config'), { recursive: true });
    const configFile = path.join(runtimeRoot, 'config', 'settings.json');
    const metadataFile = path.join(runtimeRoot, '.mcbot-runtime.json');
    const originalConfig = '{"operator":true}\n';
    const originalMetadata = '{"appVersion":"2.6.17","marker":"same-version"}\n';
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"operator":false,"newField":1}\n');
    await fsp.writeFile(configFile, originalConfig);
    await fsp.writeFile(metadataFile, originalMetadata);

    const fsOps = Object.create(fsp);
    fsOps.cp = async (source, destination, options) => {
        await fsp.cp(source, destination, options);
        if (String(destination).includes('.mcbot-config-transaction-')) {
            await fsp.writeFile(path.join(destination, 'settings.json'), 'CORRUPTED-SNAPSHOT');
        }
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.17', fsOps });
    await assert.rejects(() => migrator.prepare(), error => {
        assert.equal(error?.details?.rollback?.targetUntouched, true);
        return true;
    });
    assert.equal(await fsp.readFile(configFile, 'utf8'), originalConfig);
    assert.equal(await fsp.readFile(metadataFile, 'utf8'), originalMetadata);
});

test('RuntimeConfigMigrator preserves verified transaction snapshot when restore staging fails', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-migration-restore-stage-fail-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(path.join(runtimeRoot, 'config'), { recursive: true });
    const configFile = path.join(runtimeRoot, 'config', 'settings.json');
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"operator":true,"newField":1}\n');
    await fsp.writeFile(configFile, '{"operator":true}\n');
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), '{"appVersion":"2.6.17"}\n');

    const fsOps = Object.create(fsp);
    fsOps.cp = async (source, destination, options) => {
        if (String(destination).includes('.mcbot-config-restore-') || String(destination).includes('.mcbot-prepare-joint-closure-')) throw new Error('synthetic restore copy failure');
        return fsp.cp(source, destination, options);
    };
    const migrator = new RuntimeConfigMigrator({
        templateRoot, runtimeRoot, appVersion: '2.6.17', fsOps,
        migrationRunner: async () => { throw new Error('synthetic migration failure after merge'); }
    });
    let preserved = null;
    await assert.rejects(() => migrator.prepare(), error => {
        assert.equal(error?.details?.rollback?.success, false);
        preserved = error?.details?.transactionBackup;
        assert.ok(preserved);
        return true;
    });
    assert.equal(fs.existsSync(preserved), true, 'verified recovery snapshot must remain when rollback is incomplete');
    assert.equal(await fsp.readFile(path.join(preserved, 'settings.json'), 'utf8'), '{"operator":true}\n');
    assert.equal(fs.existsSync(configFile), true, 'active config tree must not disappear on failed restore staging');
});

test('RuntimeConfigMigrator treats transient cleanup failure after metadata commit as warning, not rollback', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-migration-cleanup-after-commit-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(path.join(runtimeRoot, 'config'), { recursive: true });
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"operator":true,"newField":1}\n');
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'settings.json'), '{"operator":true}\n');
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), '{"appVersion":"2.6.17","marker":"before"}\n');

    const fsOps = Object.create(fsp);
    fsOps.rm = async (target, options) => {
        if (String(target).includes('.mcbot-config-transaction-')) throw new Error('synthetic post-commit cleanup failure');
        return fsp.rm(target, options);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.17', fsOps });
    const report = await migrator.prepare();
    assert.equal(JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config', 'settings.json'), 'utf8')).newField, 1);
    assert.equal(JSON.parse(await fsp.readFile(path.join(runtimeRoot, '.mcbot-runtime.json'), 'utf8')).appVersion, '2.6.17');
    assert.ok(report.warnings.some(warning => warning.code === 'RUNTIME_CONFIG_TRANSACTION_CLEANUP_FAILED'));
});

test('rollbackLastConfig copy failure leaves current config and metadata byte-identical', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-explicit-rollback-copy-fail-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    await fsp.mkdir(path.join(runtimeRoot, 'config'), { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    const current = '{"value":"current"}\n';
    const old = '{"value":"old"}\n';
    const metadata = `${JSON.stringify({ appVersion: '2.6.17', lastBackup: backup, marker: 'keep' })}\n`;
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'settings.json'), current);
    await fsp.writeFile(path.join(backup, 'settings.json'), old);
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), metadata);

    const fsOps = Object.create(fsp);
    fsOps.cp = async (source, destination, options) => {
        if (String(destination).includes('.mcbot-explicit-rollback-')) throw new Error('synthetic rollback stage copy failure');
        return fsp.cp(source, destination, options);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.17', fsOps });
    await assert.rejects(() => migrator.rollbackLastConfig(), /synthetic rollback stage copy failure/);
    assert.equal(await fsp.readFile(path.join(runtimeRoot, 'config', 'settings.json'), 'utf8'), current);
    assert.equal(await fsp.readFile(path.join(runtimeRoot, '.mcbot-runtime.json'), 'utf8'), metadata);
});

test('rollbackLastConfig rejects backup digest mismatch before mutating current config', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-explicit-rollback-digest-mismatch-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    await fsp.mkdir(path.join(runtimeRoot, 'config'), { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    const current = '{"value":"current"}\n';
    const metadata = `${JSON.stringify({ appVersion: '2.6.17', lastBackup: backup, lastBackupDigest: 'not-the-backup-digest' })}\n`;
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'settings.json'), current);
    await fsp.writeFile(path.join(backup, 'settings.json'), '{"value":"old"}\n');
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), metadata);

    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.17' });
    await assert.rejects(() => migrator.rollbackLastConfig(), /verification failed/);
    assert.equal(await fsp.readFile(path.join(runtimeRoot, 'config', 'settings.json'), 'utf8'), current);
    assert.equal(await fsp.readFile(path.join(runtimeRoot, '.mcbot-runtime.json'), 'utf8'), metadata);
});

test('rollbackLastConfig metadata failure restores both config and metadata to pre-rollback state', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-explicit-rollback-metadata-fail-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    await fsp.mkdir(path.join(runtimeRoot, 'config'), { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    const current = '{"value":"current"}\n';
    const old = '{"value":"old"}\n';
    const metadataFile = path.join(runtimeRoot, '.mcbot-runtime.json');
    const metadata = `${JSON.stringify({ appVersion: '2.6.17', lastBackup: backup, marker: 'keep' })}\n`;
    await fsp.writeFile(path.join(runtimeRoot, 'config', 'settings.json'), current);
    await fsp.writeFile(path.join(backup, 'settings.json'), old);
    await fsp.writeFile(metadataFile, metadata);

    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        if (destination === metadataFile && String(source).includes('.mcbot-runtime.json.tmp-rollback-')) throw new Error('synthetic metadata commit failure');
        return fsp.rename(source, destination);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.17', fsOps });
    await assert.rejects(() => migrator.rollbackLastConfig(), /synthetic metadata commit failure/);
    assert.equal(await fsp.readFile(path.join(runtimeRoot, 'config', 'settings.json'), 'utf8'), current);
    assert.equal(await fsp.readFile(metadataFile, 'utf8'), metadata);
});

test('rollbackLastConfig falls back to verified safety copy when staged install and displaced restore both fail', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rollback-double-rename-fail-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    const current = '{"value":"current"}\n';
    const old = '{"value":"old"}\n';
    const metadata = `${JSON.stringify({ appVersion: '2.6.18', lastBackup: backup, marker: 'before' })}\n`;
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), current);
    await fsp.writeFile(path.join(backup, 'settings.json'), old);
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), metadata);

    let stagedInstallFailed = false;
    let displacedRestoreFailed = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        const dst = String(destination);
        if (!stagedInstallFailed && dst === runtimeConfig
            && src.includes('.mcbot-explicit-rollback-')
            && !src.includes('.mcbot-explicit-rollback-recovery-')) {
            stagedInstallFailed = true;
            throw new Error('synthetic staged restore install failure');
        }
        if (!displacedRestoreFailed && dst === runtimeConfig && src.includes('.rollback-current-')) {
            displacedRestoreFailed = true;
            throw new Error('synthetic displaced restore failure');
        }
        return fsp.rename(source, destination);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.18', fsOps });
    await assert.rejects(() => migrator.rollbackLastConfig(), /synthetic staged restore install failure|RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED/);
    assert.equal(stagedInstallFailed, true);
    assert.equal(displacedRestoreFailed, true);
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), current);
    assert.equal(await fsp.readFile(path.join(runtimeRoot, '.mcbot-runtime.json'), 'utf8'), metadata);
});

test('rollbackLastConfig metadata failure plus displaced restore failure recovers current config from verified safety copy', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rollback-metadata-fallback-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    const current = '{"value":"current","operator":true}\n';
    const old = '{"value":"old"}\n';
    const metadata = `${JSON.stringify({ appVersion: '2.6.18', lastBackup: backup, marker: 'before' })}\n`;
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), current);
    await fsp.writeFile(path.join(backup, 'settings.json'), old);
    await fsp.writeFile(metadataPath, metadata);

    let metadataFailed = false;
    let displacedRestoreFailed = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        const dst = String(destination);
        if (!metadataFailed && src.includes('.mcbot-runtime.json.tmp-rollback-') && dst === metadataPath) {
            metadataFailed = true;
            throw new Error('synthetic rollback metadata failure');
        }
        if (!displacedRestoreFailed && src === runtimeConfig && dst.includes('.recovery-displaced-1')) {
            displacedRestoreFailed = true;
            throw new Error('synthetic displaced restore failure after metadata fault');
        }
        return fsp.rename(source, destination);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.18', fsOps });
    await assert.rejects(() => migrator.rollbackLastConfig(), /synthetic rollback metadata failure|RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED/);
    assert.equal(metadataFailed, true);
    assert.equal(displacedRestoreFailed, true);
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), current);
    assert.equal(await fsp.readFile(metadataPath, 'utf8'), metadata);
});

test('failed prepare uses verified original rollback source when staged install and displaced restore fail', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-prepare-recovery-double-fail-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeConfig, { recursive: true });
    const current = '{"operator":true}\n';
    const metadata = '{"appVersion":"2.6.18","marker":"before"}\n';
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"operator":false,"newField":1}\n');
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), current);
    await fsp.writeFile(metadataPath, metadata);

    let stagedInstallFailed = false;
    let displacedRestoreFailed = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        const dst = String(destination);
        if (!stagedInstallFailed && dst === runtimeConfig && src.includes('.mcbot-config-restore-')) {
            stagedInstallFailed = true;
            throw new Error('synthetic failed-prepare staged install failure');
        }
        if (!displacedRestoreFailed && dst === runtimeConfig && src.includes('.mcbot-prepare-fallback-recovery-')) {
            displacedRestoreFailed = true;
            throw new Error('synthetic failed-prepare fallback install failure');
        }
        return fsp.rename(source, destination);
    };
    const migrationRunner = async () => { throw new Error('synthetic migration failure after mutation'); };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.18', migrationRunner, fsOps });
    await assert.rejects(() => migrator.prepare(), /synthetic migration failure after mutation/);
    assert.equal(stagedInstallFailed, true);
    assert.equal(displacedRestoreFailed, true);
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), current);
    assert.equal(await fsp.readFile(metadataPath, 'utf8'), metadata);
});

test('RF5 T5 failed prepare recovers original bytes through alternate stage after first restore copy failure', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf5-prepare-alt-copy-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeConfig, { recursive: true });
    const original = '{"operator":true}\n';
    const metadata = '{  "appVersion" : "2.6.19", "marker" : "before" }\n';
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"operator":true,"newField":1}\n');
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), original);
    await fsp.writeFile(metadataPath, metadata);
    let failedInitialRestoreCopy = false;
    const fsOps = Object.create(fsp);
    fsOps.cp = async (source, destination, options) => {
        const dst = String(destination);
        if (!failedInitialRestoreCopy && dst.includes('.mcbot-config-restore-') && !dst.includes('.mcbot-config-restore-alt-')) {
            failedInitialRestoreCopy = true;
            throw new Error('synthetic first restore copy failure');
        }
        return fsp.cp(source, destination, options);
    };
    const migrationRunner = async () => {
        await fsp.writeFile(path.join(runtimeConfig, 'migration-side-effect.json'), '{"mutated":true}\n');
        throw new Error('synthetic migration failure');
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.19', migrationRunner, fsOps });
    let caught;
    try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(failedInitialRestoreCopy, true);
    assert.equal(caught.details.rollback.success, true);
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), original);
    assert.equal(fs.existsSync(path.join(runtimeConfig, 'migration-side-effect.json')), false);
    assert.equal(await fsp.readFile(metadataPath, 'utf8'), metadata);
});

test('RF5 T6 failed prepare ignores corrupted first restore stage and restores from clean alternate stage', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf5-prepare-alt-corrupt-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeConfig, { recursive: true });
    const original = '{"operator":"original"}\n';
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"operator":"original","newField":1}\n');
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), original);
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), '{"appVersion":"2.6.19"}\n');
    let corrupted = false;
    const fsOps = Object.create(fsp);
    fsOps.cp = async (source, destination, options) => {
        await fsp.cp(source, destination, options);
        const dst = String(destination);
        if (!corrupted && dst.includes('.mcbot-config-restore-') && !dst.includes('.mcbot-config-restore-alt-')) {
            corrupted = true;
            await fsp.writeFile(path.join(destination, 'settings.json'), '{"corrupt":true}\n');
        }
    };
    const migrationRunner = async () => { throw new Error('synthetic migration failure'); };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.19', migrationRunner, fsOps });
    let caught;
    try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(corrupted, true);
    assert.equal(caught.details.rollback.success, true);
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), original);
});

test('RF5 T7 persistent restore copy failure preserves active target and verified rollback source without false success', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf5-prepare-copy-persistent-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"operator":true,"newField":1}\n');
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), '{"operator":true}\n');
    const metadata = '{"appVersion":"2.6.19","marker":"before"}\n';
    await fsp.writeFile(metadataPath, metadata);
    const fsOps = Object.create(fsp);
    fsOps.cp = async (source, destination, options) => {
        if (String(destination).includes('.mcbot-config-restore') || String(destination).includes('.mcbot-prepare-joint-closure-')) throw new Error('synthetic persistent restore copy failure');
        return fsp.cp(source, destination, options);
    };
    const migrationRunner = async () => { throw new Error('synthetic migration failure after merge'); };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.19', migrationRunner, fsOps });
    let caught;
    try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(caught.details.rollback.success, false);
    assert.equal(fs.existsSync(runtimeConfig), true, 'active target must remain present');
    assert.equal(await fsp.readFile(metadataPath, 'utf8'), metadata);
    const source = caught.details.rollback.preservedRollbackSource;
    assert.ok(source && fs.existsSync(source), 'verified original snapshot must be preserved');
    assert.match(String(caught.details.rollback.message), /RUNTIME_CONFIG_RECOVERY_FAILED|restore/i);
});

test('RF5 T8 rollback metadata throw after successful rename restores exact pre-operation bytes and config', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf5-metadata-post-rename-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    const current = '{"value":"current"}\n';
    const metadata = '{  "appVersion" : "2.6.19", "lastBackup" : ' + JSON.stringify(backup) + ', "marker" : "exact" }\n';
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), current);
    await fsp.writeFile(path.join(backup, 'settings.json'), '{"value":"old"}\n');
    await fsp.writeFile(metadataPath, metadata);
    let postRenameThrown = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!postRenameThrown && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            await fsp.rename(source, destination);
            postRenameThrown = true;
            throw new Error('synthetic post-rename metadata exception');
        }
        return fsp.rename(source, destination);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.19', fsOps });
    await assert.rejects(() => migrator.rollbackLastConfig(), /synthetic post-rename metadata exception/);
    assert.equal(postRenameThrown, true);
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), current);
    assert.equal(await fsp.readFile(metadataPath, 'utf8'), metadata, 'metadata bytes must be restored exactly');
});

test('RF5 T9 metadata restore failure reports fatal recovery and preserves config safety source', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf5-metadata-restore-fail-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    const current = '{"value":"current"}\n';
    const metadata = '{ "appVersion":"2.6.19", "lastBackup":' + JSON.stringify(backup) + ' }\n';
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), current);
    await fsp.writeFile(path.join(backup, 'settings.json'), '{"value":"old"}\n');
    await fsp.writeFile(metadataPath, metadata);
    let commitThrown = false;
    let restoreThrown = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!commitThrown && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            await fsp.rename(source, destination);
            commitThrown = true;
            throw new Error('synthetic post-rename metadata exception');
        }
        if (destination === metadataPath && src.includes('.mcbot-runtime.json.restore-rollback-')) {
            restoreThrown = true;
            throw new Error('synthetic metadata restore failure');
        }
        return fsp.rename(source, destination);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.19', fsOps });
    let caught;
    try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(caught.code, 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED');
    assert.equal(commitThrown, true);
    assert.equal(restoreThrown, true);
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), current);
    assert.ok(caught.details.rollbackBackup && fs.existsSync(caught.details.rollbackBackup), 'verified config safety copy must be preserved');
    assert.ok(caught.details.metadataExpectedDigest);
    assert.ok(Array.isArray(caught.details.recoveryErrors) && caught.details.recoveryErrors.some(message => /metadata restore failure/.test(message)));
});


test('RF6 T1 prepare metadata rename succeeds then throws and rolls config plus exact metadata bytes back', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf6-prepare-metadata-post-rename-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeConfig, { recursive: true });
    const originalConfig = '{"operator":"keep"}\n';
    const originalMetadata = '{  "appVersion" : "2.6.20", "marker" : "M0" }\n';
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"operator":"default","newField":1}\n');
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), originalConfig);
    await fsp.writeFile(metadataPath, originalMetadata);
    let postRenameThrown = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!postRenameThrown && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-prepare-')) {
            await fsp.rename(source, destination);
            postRenameThrown = true;
            throw new Error('synthetic prepare metadata post-rename exception');
        }
        return fsp.rename(source, destination);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.21', fsOps });
    let caught;
    try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(postRenameThrown, true);
    assert.equal(caught.details.metadataAdvanced, false);
    assert.equal(caught.details.rollback.success, true);
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), originalConfig);
    assert.equal(await fsp.readFile(metadataPath, 'utf8'), originalMetadata);
    assert.equal(JSON.parse(await fsp.readFile(metadataPath, 'utf8')).appVersion, '2.6.20');
});

test('RF6 T2 prepare from absent config and metadata returns both to absent after metadata rename side effect then throw', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf6-prepare-absent-post-rename-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"created":true}\n');
    let postRenameThrown = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!postRenameThrown && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-prepare-')) {
            await fsp.rename(source, destination);
            postRenameThrown = true;
            throw new Error('synthetic absent prepare metadata post-rename exception');
        }
        return fsp.rename(source, destination);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.21', fsOps });
    let caught;
    try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(postRenameThrown, true);
    assert.equal(caught.details.rollback.success, true);
    assert.equal(fs.existsSync(runtimeConfig), false);
    assert.equal(fs.existsSync(metadataPath), false);
});

test('RF6 T3 failed-prepare displacement rename side-effects then throws but verified D0 is restored', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf6-prepare-displace-post-rename-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeConfig, { recursive: true });
    const originalConfig = '{"operator":"D0"}\n';
    const originalMetadata = '{"appVersion":"2.6.20","marker":"M0"}\n';
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"operator":"template","newField":1}\n');
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), originalConfig);
    await fsp.writeFile(metadataPath, originalMetadata);
    let displacementThrown = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        if (!displacementThrown && String(source) === runtimeConfig && String(destination).includes('.failed-')) {
            await fsp.rename(source, destination);
            displacementThrown = true;
            throw new Error('synthetic failed-prepare post-displacement exception');
        }
        return fsp.rename(source, destination);
    };
    const migrationRunner = async () => {
        await fsp.writeFile(path.join(runtimeConfig, 'side-effect.json'), '{"D1":true}\n');
        throw new Error('synthetic migration failure');
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.21', migrationRunner, fsOps });
    let caught;
    try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(displacementThrown, true);
    assert.equal(caught.details.rollback.success, true);
    assert.equal(fs.existsSync(runtimeConfig), true);
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), originalConfig);
    assert.equal(fs.existsSync(path.join(runtimeConfig, 'side-effect.json')), false);
    assert.equal(await fsp.readFile(metadataPath, 'utf8'), originalMetadata);
});

test('RF6 T4 explicit rollback displacement rename side-effects then throws and exact pre-operation state is restored', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf6-explicit-displace-post-rename-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    const current = '{"value":"current-D0"}\n';
    const metadata = '{  "appVersion":"2.6.20", "lastBackup":' + JSON.stringify(backup) + ', "marker":"M0" }\n';
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), current);
    await fsp.writeFile(path.join(backup, 'settings.json'), '{"value":"old"}\n');
    await fsp.writeFile(metadataPath, metadata);
    let displacementThrown = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        if (!displacementThrown && String(source) === runtimeConfig && String(destination).includes('.rollback-current-')) {
            await fsp.rename(source, destination);
            displacementThrown = true;
            throw new Error('synthetic explicit rollback post-displacement exception');
        }
        return fsp.rename(source, destination);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.21', fsOps });
    await assert.rejects(() => migrator.rollbackLastConfig(), /post-displacement exception/);
    assert.equal(displacementThrown, true);
    assert.equal(fs.existsSync(runtimeConfig), true);
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), current);
    assert.equal(await fsp.readFile(metadataPath, 'utf8'), metadata);
});

test('RF6 T5 recovery rename side-effects then throws and active digest postcondition prevents false fatal', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf6-recovery-post-rename-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    const current = '{"value":"current"}\n';
    const metadata = '{"appVersion":"2.6.20","lastBackup":' + JSON.stringify(backup) + '}\n';
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), current);
    await fsp.writeFile(path.join(backup, 'settings.json'), '{"value":"old"}\n');
    await fsp.writeFile(metadataPath, metadata);
    let metadataCommitFailed = false;
    let recoveryRenameThrown = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!metadataCommitFailed && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            metadataCommitFailed = true;
            throw new Error('synthetic metadata commit before-side-effect failure');
        }
        if (!recoveryRenameThrown && destination === runtimeConfig && src.includes('.mcbot-explicit-rollback-recovery-')) {
            await fsp.rename(source, destination);
            recoveryRenameThrown = true;
            throw new Error('synthetic recovery rename post-side-effect exception');
        }
        return fsp.rename(source, destination);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.21', fsOps });
    let caught;
    try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(metadataCommitFailed, true);
    assert.equal(recoveryRenameThrown, true);
    assert.notEqual(caught.code, 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED');
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), current);
    assert.equal(await fsp.readFile(metadataPath, 'utf8'), metadata);
});

test('RF6 T6 persistent initial and alternate prepare staging failures preserve structured ordered diagnostics', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf6-prepare-stage-diagnostics-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeConfig, { recursive: true });
    const original = '{"operator":true}\n';
    const metadata = '{"appVersion":"2.6.20","marker":"M0"}\n';
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"operator":true,"newField":1}\n');
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), original);
    await fsp.writeFile(metadataPath, metadata);
    const fsOps = Object.create(fsp);
    fsOps.cp = async (source, destination, options) => {
        const dst = String(destination);
        if (dst.includes('.mcbot-config-restore-alt-')) {
            const error = new Error('alternate stage failure B'); error.code = 'EACCES'; throw error;
        }
        if (dst.includes('.mcbot-config-restore-')) {
            const error = new Error('initial stage failure A'); error.code = 'EPERM'; throw error;
        }
        if (dst.includes('.mcbot-prepare-joint-closure-')) {
            const error = new Error('closure stage failure C'); error.code = 'EPERM'; throw error;
        }
        return fsp.cp(source, destination, options);
    };
    const migrationRunner = async () => { throw new Error('synthetic migration failure D1'); };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.21', migrationRunner, fsOps });
    let caught;
    try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    const rollback = caught.details.rollback;
    assert.equal(rollback.success, false);
    assert.equal(rollback.code, 'RUNTIME_CONFIG_RECOVERY_FAILED');
    assert.ok(Array.isArray(rollback.recoveryAttempts));
    const stageSummaries = ['initial-verified-stage', 'alternate-verified-stage'].map(stage =>
        rollback.recoveryAttempts.filter(x => x.stage === stage).at(-1));
    assert.deepEqual(stageSummaries.map(x => x.stage), ['initial-verified-stage', 'alternate-verified-stage']);
    assert.deepEqual(stageSummaries.map(x => x.causeCode), ['EPERM', 'EACCES']);
    assert.equal(rollback.activeTargetPresent, true);
    assert.ok(rollback.activeTargetDigest);
    assert.ok(rollback.expectedDigest);
    assert.ok(rollback.rollbackSource && fs.existsSync(rollback.rollbackSource));
    assert.equal(await fsp.readFile(metadataPath, 'utf8'), metadata);
});

test('RF6 T6b mkdtemp failures before stage roots still record both bounded recovery attempts', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf6-mkdtemp-diagnostics-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"x":2}\n');
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), '{"x":1}\n');
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), '{"appVersion":"2.6.20"}\n');
    const fsOps = Object.create(fsp);
    fsOps.mkdtemp = async prefix => {
        if (String(prefix).includes('.mcbot-config-restore')) {
            const error = new Error(String(prefix).includes('-alt-') ? 'mkdtemp alternate B' : 'mkdtemp initial A');
            error.code = String(prefix).includes('-alt-') ? 'EACCES' : 'EPERM';
            throw error;
        }
        if (String(prefix).includes('.mcbot-prepare-joint-closure-')) {
            const error = new Error('mkdtemp closure C'); error.code = 'EPERM'; throw error;
        }
        return fsp.mkdtemp(prefix);
    };
    const migrationRunner = async () => { throw new Error('synthetic migration failure'); };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.21', migrationRunner, fsOps });
    let caught;
    try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    const attempts = caught.details.rollback.recoveryAttempts;
    const stageSummaries = attempts.filter(x => ['initial-verified-stage', 'alternate-verified-stage'].includes(x.stage));
    assert.equal(stageSummaries.length, 2);
    assert.deepEqual(stageSummaries.map(x => x.stage), ['initial-verified-stage', 'alternate-verified-stage']);
    assert.deepEqual(stageSummaries.map(x => x.causeCode), ['EPERM', 'EACCES']);
    assert.deepEqual(stageSummaries.map(x => x.stageRoot), [null, null]);
});

test('RF6 T7 metadata restore pre-side-effect EPERM exposes stable domain code, leaf cause and verified temp path', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf6-metadata-eperm-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    const current = '{"value":"current"}\n';
    const metadata = '{  "appVersion":"2.6.20", "lastBackup":' + JSON.stringify(backup) + ' }\n';
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), current);
    await fsp.writeFile(path.join(backup, 'settings.json'), '{"value":"old"}\n');
    await fsp.writeFile(metadataPath, metadata);
    let commitThrown = false;
    let restoreThrown = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!commitThrown && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            await fsp.rename(source, destination);
            commitThrown = true;
            throw new Error('synthetic commit post-rename exception');
        }
        if (destination === metadataPath && src.includes('.mcbot-runtime.json.restore-rollback-')) {
            restoreThrown = true;
            const error = new Error('synthetic metadata restore EPERM'); error.code = 'EPERM'; throw error;
        }
        return fsp.rename(source, destination);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.21', fsOps });
    let caught;
    try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(caught.code, 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED');
    assert.equal(caught.details.causeCode, 'EPERM');
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), current);
    assert.ok(caught.details.rollbackBackup && fs.existsSync(caught.details.rollbackBackup));
    assert.notEqual(caught.details.metadataCurrentDigest, caught.details.metadataExpectedDigest);
    assert.ok(caught.details.metadataRecoveryTemp && fs.existsSync(caught.details.metadataRecoveryTemp));
    const tempBytes = await fsp.readFile(caught.details.metadataRecoveryTemp);
    assert.equal(crypto.createHash('sha256').update(tempBytes).digest('hex'), caught.details.metadataExpectedDigest);
    assert.ok(Array.isArray(caught.details.metadataRecoveryAttempts) && caught.details.metadataRecoveryAttempts.length >= 2);
});

test('RF6 T8 commit and metadata restore rename both side-effect then throw but exact pre-state is recognized', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf6-metadata-double-post-rename-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    const current = '{"value":"current"}\n';
    const metadata = '{  "appVersion" : "2.6.20", "lastBackup" : ' + JSON.stringify(backup) + ', "marker":"M0" }\n';
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), current);
    await fsp.writeFile(path.join(backup, 'settings.json'), '{"value":"old"}\n');
    await fsp.writeFile(metadataPath, metadata);
    let commitThrown = false;
    let restoreThrown = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!commitThrown && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            await fsp.rename(source, destination);
            commitThrown = true;
            throw new Error('synthetic commit post-rename exception');
        }
        if (!restoreThrown && destination === metadataPath && src.includes('.mcbot-runtime.json.restore-rollback-')) {
            await fsp.rename(source, destination);
            restoreThrown = true;
            throw new Error('synthetic restore post-rename exception');
        }
        return fsp.rename(source, destination);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.21', fsOps });
    let caught;
    try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(commitThrown, true);
    assert.equal(restoreThrown, true);
    assert.notEqual(caught.code, 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED');
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), current);
    assert.equal(await fsp.readFile(metadataPath, 'utf8'), metadata);
    assert.equal(JSON.parse(await fsp.readFile(metadataPath, 'utf8')).rolledBackAt, undefined);
});

test('RF6 T9 corrupt metadata recovery temp is never installed and fatal diagnostics preserve source evidence', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf6-metadata-corrupt-temp-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    const current = '{"value":"current"}\n';
    const metadata = '{"appVersion":"2.6.20","lastBackup":' + JSON.stringify(backup) + ',"marker":"M0"}\n';
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), current);
    await fsp.writeFile(path.join(backup, 'settings.json'), '{"value":"old"}\n');
    await fsp.writeFile(metadataPath, metadata);
    let commitThrown = false;
    let corruptWritten = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!commitThrown && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            await fsp.rename(source, destination);
            commitThrown = true;
            throw new Error('synthetic commit post-rename exception');
        }
        return fsp.rename(source, destination);
    };
    fsOps.writeFile = async (file, data, ...rest) => {
        if (String(file).includes('.mcbot-runtime.json.restore-rollback-')) {
            corruptWritten = true;
            return fsp.writeFile(file, Buffer.from('TRUNCATED'));
        }
        return fsp.writeFile(file, data, ...rest);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.21', fsOps });
    let caught;
    try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(caught.code, 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED');
    assert.equal(corruptWritten, true);
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), current);
    assert.notEqual(caught.details.metadataCurrentDigest, caught.details.metadataExpectedDigest);
    assert.ok(caught.details.metadataRecoveryTemp && fs.existsSync(caught.details.metadataRecoveryTemp));
    const attempts = caught.details.metadataRecoveryAttempts;
    assert.ok(attempts.some(x => x.stage === 'metadata-restore-stage-verify' && x.success === false));
    assert.equal((await fsp.readFile(caught.details.metadataRecoveryTemp, 'utf8')), 'TRUNCATED');
});

test('RF7 T10 failed prepare primary D1 displacement fails before side effect and bounded alternate recovery installs D0', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf7-t10-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeConfig, { recursive: true });
    const d0 = '{"operator":"D0"}\n';
    const m0 = '{  "appVersion" : "2.6.21", "marker" : "M0" }\n';
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"operator":"D0","newField":1}\n');
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), d0);
    await fsp.writeFile(metadataPath, m0);

    let primaryDisplacementFailed = false;
    let metadataFailure = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        const dst = String(destination);
        if (!metadataFailure && dst === metadataPath && src.includes('.mcbot-runtime.json.tmp-prepare-')) {
            metadataFailure = true;
            throw new Error('RF7 T10 synthetic prepare metadata failure');
        }
        if (!primaryDisplacementFailed && src === runtimeConfig && dst.includes('.failed-')) {
            primaryDisplacementFailed = true;
            const error = new Error('RF7 T10 primary D1 displacement EPERM');
            error.code = 'EPERM';
            throw error;
        }
        return fsp.rename(source, destination);
    };
    const migrationRunner = async () => {
        await fsp.writeFile(path.join(runtimeConfig, 'side-effect.json'), '{"D1":true}\n');
        return { applied: [], files: [], reports: [] };
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.22', migrationRunner, fsOps });
    let caught;
    try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(primaryDisplacementFailed, true);
    assert.equal(metadataFailure, true);
    assert.equal(caught.details.rollback.success, true);
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), d0);
    assert.equal(fs.existsSync(path.join(runtimeConfig, 'side-effect.json')), false);
    assert.equal(await fsp.readFile(metadataPath, 'utf8'), m0);
    const attempts = caught.details.rollback.recoveryAttempts;
    assert.ok(attempts.some(x => x.stage === 'displace-active' && x.success === false && x.causeCode === 'EPERM'));
    const alternate = attempts.find(x => x.stage === 'displace-nonprestate-active' && x.success === true);
    assert.ok(alternate && alternate.destinationPath && alternate.destinationPath.includes('.recovery-displaced-'));
    assert.equal(fs.existsSync(alternate.destinationPath), false, 'successful final gate should cleanup owned disposable quarantine');
    assert.ok(attempts.some(x => x.stage === 'cleanup-owned-artifact-postcondition' && x.success === true));
    assert.ok(attempts.filter(x => x.operation === 'rename-call' || x.operation === 'cp-call').length < 20, 'mutation attempts must remain bounded');
    assert.ok(caught.details.rollback.closureRepairCount <= 1);
});

test('RF7 T11 failed prepare liveness D1 re-quarantine primary fails and bounded alternate succeeds', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf7-t11-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeConfig, { recursive: true });
    const d0 = '{"operator":"D0"}\n';
    const m0 = '{"appVersion":"2.6.21","marker":"M0"}\n';
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"operator":"D0","newField":1}\n');
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), d0);
    await fsp.writeFile(metadataPath, m0);

    let metadataFailure = false;
    let initialInstallFailure = false;
    let primaryDisplaceCount = 0;
    let fallbackPrimaryFailed = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        const dst = String(destination);
        if (!metadataFailure && dst === metadataPath && src.includes('.mcbot-runtime.json.tmp-prepare-')) {
            metadataFailure = true;
            throw new Error('RF7 T11 synthetic prepare metadata failure');
        }
        if (src === runtimeConfig && dst.includes('.failed-')) {
            primaryDisplaceCount += 1;
            if (primaryDisplaceCount === 2) {
                const error = new Error('RF7 T11 liveness re-quarantine EPERM');
                error.code = 'EPERM';
                throw error;
            }
        }
        if (!initialInstallFailure && dst === runtimeConfig && src.includes('.mcbot-config-restore-')) {
            initialInstallFailure = true;
            await fsp.mkdir(runtimeConfig, { recursive: true });
            await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), d0);
            await fsp.writeFile(path.join(runtimeConfig, 'side-effect.json'), '{"D1":true}\n');
            throw new Error('RF7 T11 synthetic D0 install failure with D1 reappearance');
        }
        if (!fallbackPrimaryFailed && src === runtimeConfig && dst.includes('.recovery-displaced-') && dst.endsWith('-1')) {
            fallbackPrimaryFailed = true;
            const error = new Error('RF7 T11 fallback primary quarantine EPERM');
            error.code = 'EPERM';
            throw error;
        }
        return fsp.rename(source, destination);
    };
    const migrationRunner = async () => {
        await fsp.writeFile(path.join(runtimeConfig, 'side-effect.json'), '{"D1":true}\n');
        return { applied: [], files: [], reports: [] };
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.22', migrationRunner, fsOps });
    let caught;
    try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(initialInstallFailure, true);
    assert.equal(primaryDisplaceCount >= 1, true);
    assert.equal(fallbackPrimaryFailed, true);
    assert.equal(caught.details.rollback.success, true);
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), d0);
    assert.equal(await fsp.readFile(metadataPath, 'utf8'), m0);
    const attempts = caught.details.rollback.recoveryAttempts;
    assert.ok(attempts.some(x => x.stage === 'displace-nonprestate-active' && x.success === false && x.causeCode === 'EPERM'));
    assert.ok(attempts.some(x => x.stage === 'displace-nonprestate-active-alternate' && x.success === true));
});

test('RF7 T12 failed prepare retains verified D0 source when all bounded D1 displacement attempts fail', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf7-t12-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeConfig, { recursive: true });
    const d0 = '{"operator":"D0"}\n';
    const m0 = '{"appVersion":"2.6.21","marker":"M0"}\n';
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"operator":"D0","newField":1}\n');
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), d0);
    await fsp.writeFile(metadataPath, m0);
    let metadataFailure = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        const dst = String(destination);
        if (!metadataFailure && dst === metadataPath && src.includes('.mcbot-runtime.json.tmp-prepare-')) {
            metadataFailure = true;
            throw new Error('RF7 T12 synthetic prepare metadata failure');
        }
        if (src === runtimeConfig && (dst.includes('.failed-') || dst.includes('.recovery-displaced-'))) {
            const error = new Error(`RF7 T12 cannot displace ${dst}`);
            error.code = 'EPERM';
            throw error;
        }
        return fsp.rename(source, destination);
    };
    const migrationRunner = async () => {
        await fsp.writeFile(path.join(runtimeConfig, 'side-effect.json'), '{"D1":true}\n');
        return { applied: [], files: [], reports: [] };
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.22', migrationRunner, fsOps });
    let caught;
    try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(caught.code, 'RUNTIME_CONFIG_RECOVERY_FAILED');
    assert.equal(caught.details.rollback.success, false);
    assert.equal(fs.existsSync(runtimeConfig), true);
    assert.equal(fs.existsSync(path.join(runtimeConfig, 'side-effect.json')), true, 'D1 should remain active when it cannot be safely displaced');
    const source = caught.details.rollback.preservedRollbackSource || caught.details.rollback.rollbackSource;
    assert.ok(source && fs.existsSync(source), 'verified D0 source must be retained');
    assert.equal(await fsp.readFile(path.join(source, 'settings.json'), 'utf8'), d0);
    assert.equal(caught.cause?.message, 'RF7 T12 synthetic prepare metadata failure');
    const attempts = caught.details.rollback.recoveryAttempts;
    const displacementAttempts = attempts.filter(x => x.stage === 'displace-nonprestate-active' || x.stage === 'displace-nonprestate-active-alternate');
    assert.ok(displacementAttempts.length >= 2 && displacementAttempts.length <= 4);
    assert.equal(caught.details.rollback.closureRepairCount, 1);
    assert.ok(attempts.filter(x => x.stage?.startsWith('displace-nonprestate-active')).every(x => x.success === false && x.causeCode === 'EPERM'));
});

test('RF7 T13 metadata install resolves then destination corrupts and a verified M0 recovery source is retained', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf7-t13-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    const c0 = '{"value":"current"}\n';
    const m0 = '{  "appVersion" : "2.6.21", "lastBackup" : ' + JSON.stringify(backup) + ', "marker" : "M0" }\n';
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), c0);
    await fsp.writeFile(path.join(backup, 'settings.json'), '{"value":"old"}\n');
    await fsp.writeFile(metadataPath, m0);

    let commitThrown = false;
    let restoreCorrupted = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!commitThrown && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            await fsp.rename(source, destination);
            commitThrown = true;
            throw new Error('RF7 T13 commit post-rename failure');
        }
        if (!restoreCorrupted && destination === metadataPath && src.includes('.mcbot-runtime.json.restore-rollback-')) {
            await fsp.rename(source, destination);
            await fsp.writeFile(metadataPath, 'CORRUPT-M1');
            restoreCorrupted = true;
            return;
        }
        return fsp.rename(source, destination);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.22', fsOps });
    let caught;
    try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(caught.code, 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED');
    assert.equal(commitThrown, true);
    assert.equal(restoreCorrupted, true);
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), c0);
    assert.notEqual(caught.details.metadataCurrentDigest, caught.details.metadataExpectedDigest);
    assert.equal(caught.details.metadataRecoverySourceVerified, true);
    const source = caught.details.metadataRecoverySourcePath;
    assert.ok(source && fs.existsSync(source));
    const sourceBytes = await fsp.readFile(source);
    assert.equal(crypto.createHash('sha256').update(sourceBytes).digest('hex'), caught.details.metadataExpectedDigest);
    assert.notEqual(source, metadataPath);
    assert.ok(caught.details.metadataRecoveryAttempts.some(x => x.stage === 'metadata-restore-stage-verify' && x.success === true));
    assert.ok(caught.details.verifiedSources.some(x => x.kind === 'metadata-recovery-source' && x.verified === true));
});

test('RF7 T14 transient first post-install metadata read failure reconciles final M0 without false fatal', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf7-t14-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    const c0 = '{"value":"current"}\n';
    const m0 = '{"appVersion":"2.6.21","lastBackup":' + JSON.stringify(backup) + ',"marker":"M0"}\n';
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), c0);
    await fsp.writeFile(path.join(backup, 'settings.json'), '{"value":"old"}\n');
    await fsp.writeFile(metadataPath, m0);
    let commitThrown = false;
    let restoreInstalled = false;
    let transientReadThrown = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!commitThrown && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            await fsp.rename(source, destination);
            commitThrown = true;
            throw new Error('RF7 T14 original commit failure');
        }
        if (destination === metadataPath && src.includes('.mcbot-runtime.json.restore-rollback-')) {
            const result = await fsp.rename(source, destination);
            restoreInstalled = true;
            return result;
        }
        return fsp.rename(source, destination);
    };
    fsOps.readFile = async (file, ...args) => {
        if (restoreInstalled && !transientReadThrown && String(file) === metadataPath) {
            transientReadThrown = true;
            const error = new Error('RF7 T14 transient metadata read');
            error.code = 'EIO';
            throw error;
        }
        return fsp.readFile(file, ...args);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.22', fsOps });
    let caught;
    try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(transientReadThrown, true);
    assert.notEqual(caught.code, 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED');
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), c0);
    assert.equal(await fsp.readFile(metadataPath, 'utf8'), m0);
    assert.equal(caught.recovery?.success, true);
    const attempts = caught.recovery?.metadata?.recoveryAttempts || [];
    assert.ok(attempts.some(x => x.stage === 'metadata-restore-post-install-observe' && x.success === false && x.causeCode === 'EIO'));
    assert.ok(attempts.some(x => x.stage === 'metadata-restore-post-install-observe' && x.success === true));
    assert.equal(caught.recovery?.metadata?.sourcePath || null, null);
});

test('RF7 T15 active metadata already equals M0 so unnecessary corrupt restore temp cannot cause fatal recovery', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf7-t15-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeConfig, { recursive: true });
    const d0 = '{"operator":"D0"}\n';
    const m0 = '{ "appVersion":"2.6.21", "marker":"M0" }\n';
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"operator":"D0","newField":1}\n');
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), d0);
    await fsp.writeFile(metadataPath, m0);
    let metadataCommitFailed = false;
    let corruptRestoreWriteAttempted = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!metadataCommitFailed && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-prepare-')) {
            metadataCommitFailed = true;
            throw new Error('RF7 T15 metadata commit failed before side effect');
        }
        return fsp.rename(source, destination);
    };
    fsOps.writeFile = async (file, data, ...args) => {
        if (String(file).includes('.mcbot-runtime.json.restore-prepare-')) {
            corruptRestoreWriteAttempted = true;
            return fsp.writeFile(file, 'CORRUPT');
        }
        return fsp.writeFile(file, data, ...args);
    };
    const migrationRunner = async () => ({ applied: [], files: [], reports: [] });
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.22', migrationRunner, fsOps });
    let caught;
    try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(caught.details.rollback.success, true);
    assert.equal(corruptRestoreWriteAttempted, false, 'already-satisfied metadata postcondition must short-circuit temp mutation');
    assert.equal(await fsp.readFile(metadataPath, 'utf8'), m0);
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), d0);
});

test('RF7 T16 metadata source recreation failure is bounded and never labels corrupt bytes verified', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf7-t16-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    const c0 = '{"value":"current"}\n';
    const m0 = '{"appVersion":"2.6.21","lastBackup":' + JSON.stringify(backup) + '}\n';
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), c0);
    await fsp.writeFile(path.join(backup, 'settings.json'), '{"value":"old"}\n');
    await fsp.writeFile(metadataPath, m0);
    let commitThrown = false;
    let restoreCorrupted = false;
    let recreationFailed = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!commitThrown && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            await fsp.rename(source, destination);
            commitThrown = true;
            throw new Error('RF7 T16 original commit failure');
        }
        if (!restoreCorrupted && destination === metadataPath && src.includes('.mcbot-runtime.json.restore-rollback-')) {
            await fsp.rename(source, destination);
            await fsp.writeFile(metadataPath, 'CORRUPT');
            restoreCorrupted = true;
            return;
        }
        return fsp.rename(source, destination);
    };
    fsOps.writeFile = async (file, data, ...args) => {
        if (!recreationFailed && String(file).includes('.mcbot-runtime.json.restore-source-rollback-')) {
            recreationFailed = true;
            const error = new Error('RF7 T16 source recreation ENOSPC');
            error.code = 'ENOSPC';
            throw error;
        }
        return fsp.writeFile(file, data, ...args);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.22', fsOps });
    let caught;
    try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(caught.code, 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED');
    assert.equal(recreationFailed, true);
    assert.equal(caught.details.metadataRecoverySourceVerified, false);
    assert.equal(caught.details.metadataRecoverySourcePath, null);
    assert.ok(caught.details.metadataRecoveryAttempts.some(x => x.stage.includes('source-recreate') && x.success === false && x.causeCode === 'ENOSPC'));
    const recreateAttempts = caught.details.metadataRecoveryAttempts.filter(x => String(x.stage).includes('metadata-restore-source-recreate'));
    assert.ok(recreateAttempts.length <= 8);
});

test('RF7 T17 failed prepare D0 originally absent recognizes rm throw-after-side-effect as successful absence recovery', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf7-t17-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeRoot, { recursive: true });
    const m0 = '{"appVersion":"2.6.21","marker":"M0"}\n';
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"created":true}\n');
    await fsp.writeFile(metadataPath, m0);
    let removeThrown = false;
    const fsOps = Object.create(fsp);
    fsOps.rm = async (target, options) => {
        if (!removeThrown && String(target) === runtimeConfig) {
            await fsp.rm(target, options);
            removeThrown = true;
            const error = new Error('RF7 T17 remove post-side-effect');
            error.code = 'EIO';
            throw error;
        }
        return fsp.rm(target, options);
    };
    const migrationRunner = async () => { throw new Error('RF7 T17 original migration failure'); };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.22', migrationRunner, fsOps });
    let caught;
    try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(removeThrown, true);
    assert.notEqual(caught.code, 'RUNTIME_CONFIG_RECOVERY_FAILED');
    assert.equal(caught.details.rollback.success, true);
    assert.equal(fs.existsSync(runtimeConfig), false);
    assert.equal(await fsp.readFile(metadataPath, 'utf8'), m0);
    assert.ok(caught.details.rollback.config.recoveryAttempts.some(x => x.stage === 'restore-original-absent-config' && x.postcondition === 'remove-threw-postcondition-matched'));
});

test('RF7 T18 explicit rollback C0 originally absent recognizes removal throw-after-side-effect and preserves original rollback failure', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf7-t18-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(backup, { recursive: true });
    const m0 = '{"appVersion":"2.6.21","lastBackup":' + JSON.stringify(backup) + ',"marker":"M0"}\n';
    await fsp.writeFile(path.join(backup, 'settings.json'), '{"value":"backup"}\n');
    await fsp.mkdir(runtimeRoot, { recursive: true });
    await fsp.writeFile(metadataPath, m0);
    let metadataFailure = false;
    let removeThrown = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!metadataFailure && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            metadataFailure = true;
            throw new Error('RF7 T18 original rollback metadata failure');
        }
        return fsp.rename(source, destination);
    };
    fsOps.rm = async (target, options) => {
        if (!removeThrown && String(target) === runtimeConfig) {
            await fsp.rm(target, options);
            removeThrown = true;
            const error = new Error('RF7 T18 remove post-side-effect');
            error.code = 'EIO';
            throw error;
        }
        return fsp.rm(target, options);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.22', fsOps });
    let caught;
    try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(metadataFailure, true);
    assert.equal(removeThrown, true);
    assert.notEqual(caught.code, 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED');
    assert.equal(fs.existsSync(runtimeConfig), false);
    assert.equal(await fsp.readFile(metadataPath, 'utf8'), m0);
    assert.equal(caught.recovery?.success, true);
    assert.ok(caught.recovery?.config?.recoveryAttempts.some(x => x.stage === 'restore-original-absent-config' && x.postcondition === 'remove-threw-postcondition-matched'));
});

test('RF7 T19 explicit rollback recovery-root mkdtemp failure is recorded with stable code and retained evidence', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf7-t19-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    const c0 = '{"value":"current"}\n';
    const m0 = '{"appVersion":"2.6.21","lastBackup":' + JSON.stringify(backup) + '}\n';
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), c0);
    await fsp.writeFile(path.join(backup, 'settings.json'), '{"value":"old"}\n');
    await fsp.writeFile(metadataPath, m0);
    let metadataFailure = false;
    let recoveryRootFailed = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!metadataFailure && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            metadataFailure = true;
            throw new Error('RF7 T19 original rollback metadata failure');
        }
        return fsp.rename(source, destination);
    };
    fsOps.mkdtemp = async prefix => {
        if (String(prefix).includes('.mcbot-explicit-rollback-recovery-')) {
            recoveryRootFailed = true;
            const error = new Error('RF7 T19 recovery root EPERM');
            error.code = 'EPERM';
            throw error;
        }
        return fsp.mkdtemp(prefix);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.22', fsOps });
    let caught;
    try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(recoveryRootFailed, true);
    assert.notEqual(caught.code, 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED');
    assert.equal(caught.recovery?.success, true);
    assert.equal(caught.recovery?.closureRepairCount, 1);
    const rootAttempt = caught.recovery.attempts.find(x => x.operation === 'mkdtemp' && x.callOutcome === 'rejected' && x.causeCode === 'EPERM');
    assert.ok(rootAttempt);
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), c0);
});

test('RF7 T20 originally absent metadata removal throw-after-side-effect is reconciled as success', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf7-t20-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeRoot, { recursive: true });
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"created":true}\n');
    let commitThrown = false;
    let removeThrown = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!commitThrown && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-prepare-')) {
            await fsp.rename(source, destination);
            commitThrown = true;
            throw new Error('RF7 T20 prepare metadata post-rename failure');
        }
        return fsp.rename(source, destination);
    };
    fsOps.rm = async (target, options) => {
        if (!removeThrown && String(target) === metadataPath) {
            await fsp.rm(target, options);
            removeThrown = true;
            const error = new Error('RF7 T20 metadata remove post-side-effect');
            error.code = 'EIO';
            throw error;
        }
        return fsp.rm(target, options);
    };
    const migrationRunner = async () => ({ applied: [], files: [], reports: [] });
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.22', migrationRunner, fsOps });
    let caught;
    try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(commitThrown, true);
    assert.equal(removeThrown, true);
    assert.notEqual(caught.code, 'RUNTIME_CONFIG_RECOVERY_FAILED');
    assert.equal(caught.details.rollback.success, true);
    assert.equal(fs.existsSync(runtimeConfig), false);
    assert.equal(fs.existsSync(metadataPath), false);
    const attempts = caught.details.rollback.metadata.recoveryAttempts;
    assert.ok(attempts.some(x => x.stage === 'restore-original-absence' && x.postcondition === 'remove-threw-postcondition-matched'));
});

test('RF8 T21 failed prepare uses final joint gate after metadata restore mutates recovered config', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf8-t21-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const configFile = path.join(runtimeConfig, 'settings.json');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeConfig, { recursive: true });
    const d0 = '{"value":"D0"}\n';
    const m0 = '{  "appVersion" : "2.6.22", "marker" : "M0" }\n';
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"value":"D1","newField":1}\n');
    await fsp.writeFile(configFile, d0);
    await fsp.writeFile(metadataPath, m0);

    let commitThrown = false;
    let sabotaged = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!commitThrown && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-prepare-')) {
            await fsp.rename(source, destination);
            commitThrown = true;
            throw new Error('RF8 T21 original prepare metadata failure');
        }
        const result = await fsp.rename(source, destination);
        if (!sabotaged && destination === metadataPath && src.includes('.restore-prepare-')) {
            await fsp.writeFile(configFile, '{"value":"D2"}\n');
            sabotaged = true;
        }
        return result;
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.23', fsOps });
    let caught;
    try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(commitThrown, true);
    assert.equal(sabotaged, true);
    assert.equal(caught.details.rollback.success, true);
    assert.equal(caught.details.rollback.closureRepairCount, 1);
    assert.equal(caught.details.rollback.jointGate.success, true);
    assert.equal(caught.details.rollback.jointGate.config.matched, true);
    assert.equal(caught.details.rollback.jointGate.metadata.matched, true);
    assert.equal(await fsp.readFile(configFile, 'utf8'), d0);
    assert.equal(await fsp.readFile(metadataPath, 'utf8'), m0);
    assert.ok(caught.details.rollback.jointGate.attempts.some(x => x.phase === 'prepare-joint-verify-1' && x.success === false));
    assert.ok(caught.details.rollback.jointGate.attempts.some(x => x.phase === 'prepare-joint-verify-2' && x.success === true));
});

test('RF8 T22 explicit rollback uses final joint gate after metadata restore mutates recovered config', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf8-t22-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const configFile = path.join(runtimeConfig, 'settings.json');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    const c0 = '{"value":"C0"}\n';
    const b = '{"value":"B"}\n';
    const m0 = '{  "appVersion" : "2.6.22", "lastBackup" : ' + JSON.stringify(backup) + ', "marker" : "M0" }\n';
    await fsp.writeFile(configFile, c0);
    await fsp.writeFile(path.join(backup, 'settings.json'), b);
    await fsp.writeFile(metadataPath, m0);

    let commitThrown = false;
    let sabotaged = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!commitThrown && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            await fsp.rename(source, destination);
            commitThrown = true;
            throw new Error('RF8 T22 original rollback metadata failure');
        }
        const result = await fsp.rename(source, destination);
        if (!sabotaged && destination === metadataPath && src.includes('.restore-rollback-')) {
            await fsp.writeFile(configFile, '{"value":"C2"}\n');
            sabotaged = true;
        }
        return result;
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.23', fsOps });
    let caught;
    try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(commitThrown, true);
    assert.equal(sabotaged, true);
    assert.notEqual(caught.code, 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED');
    assert.equal(caught.recovery?.success, true);
    assert.equal(caught.recovery?.closureRepairCount, 1);
    assert.equal(caught.recovery?.jointGate?.success, true);
    assert.equal(await fsp.readFile(configFile, 'utf8'), c0);
    assert.equal(await fsp.readFile(metadataPath, 'utf8'), m0);
});

test('RF8 T23 repeated cross-component sabotage stops after one closure repair and retains recovery evidence', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf8-t23-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const configFile = path.join(runtimeConfig, 'settings.json');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeConfig, { recursive: true });
    const d0 = '{"value":"D0"}\n';
    const m0 = '{"appVersion":"2.6.22","marker":"M0"}\n';
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"value":"D1","newField":1}\n');
    await fsp.writeFile(configFile, d0);
    await fsp.writeFile(metadataPath, m0);

    let commitThrown = false;
    let firstMetadataSabotage = false;
    let closureConfigInstalled = false;
    let secondMetadataSabotage = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!commitThrown && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-prepare-')) {
            await fsp.rename(source, destination);
            commitThrown = true;
            throw new Error('RF8 T23 original prepare metadata failure');
        }
        const result = await fsp.rename(source, destination);
        if (!firstMetadataSabotage && destination === metadataPath && src.includes('.restore-prepare-')) {
            await fsp.writeFile(configFile, '{"value":"D2"}\n');
            firstMetadataSabotage = true;
        } else if (!closureConfigInstalled && destination === runtimeConfig && src.includes('prepare-joint-closure')) {
            closureConfigInstalled = true;
            await fsp.writeFile(metadataPath, '{"appVersion":"CORRUPT"}\n');
        } else if (closureConfigInstalled && !secondMetadataSabotage && destination === metadataPath && src.includes('.restore-prepare-closure-')) {
            await fsp.writeFile(configFile, '{"value":"D3"}\n');
            secondMetadataSabotage = true;
        }
        return result;
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.23', fsOps });
    let caught;
    try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(caught.code, 'RUNTIME_CONFIG_RECOVERY_FAILED');
    assert.equal(caught.details.rollback.success, false);
    assert.equal(caught.details.rollback.closureRepairCount, 1);
    assert.equal(caught.details.rollback.jointGate.success, false);
    assert.ok(caught.details.verifiedRollbackSource && fs.existsSync(caught.details.verifiedRollbackSource));
    assert.ok(caught.details.rollback.jointGate.attempts.filter(x => x.stage === 'joint-prestate-verify').length <= 4);
});

test('RF8 T24 final joint gate retries one transient config read without mutation retry', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf8-t24-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const configFile = path.join(runtimeConfig, 'settings.json');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeConfig, { recursive: true });
    const d0 = '{"value":"D0"}\n';
    const m0 = '{"appVersion":"2.6.22","marker":"M0"}\n';
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"value":"D1","newField":1}\n');
    await fsp.writeFile(configFile, d0);
    await fsp.writeFile(metadataPath, m0);

    let commitThrown = false;
    let metadataRestored = false;
    let jointReadThrown = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!commitThrown && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-prepare-')) {
            await fsp.rename(source, destination);
            commitThrown = true;
            throw new Error('RF8 T24 original prepare metadata failure');
        }
        const result = await fsp.rename(source, destination);
        if (destination === metadataPath && src.includes('.restore-prepare-')) metadataRestored = true;
        return result;
    };
    fsOps.readFile = async (...args) => {
        const target = String(args[0]);
        if (metadataRestored && !jointReadThrown && target === configFile) {
            jointReadThrown = true;
            const error = new Error('RF8 T24 transient joint config EIO');
            error.code = 'EIO';
            throw error;
        }
        return fsp.readFile(...args);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.23', fsOps });
    let caught;
    try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(jointReadThrown, true);
    assert.equal(caught.details.rollback.success, true);
    assert.equal(caught.details.rollback.closureRepairCount, 0);
    const jointAttempts = caught.details.rollback.jointGate.attempts.filter(x => x.phase === 'prepare-joint-verify-1');
    assert.equal(jointAttempts.length, 2);
    assert.equal(jointAttempts[0].config.state, 'unreadable');
    assert.equal(jointAttempts[0].config.readError.code, 'EIO');
    assert.equal(jointAttempts[1].success, true);
    assert.equal(await fsp.readFile(configFile, 'utf8'), d0);
    assert.equal(await fsp.readFile(metadataPath, 'utf8'), m0);
});

test('RF8 T25 failed-prepare stage cp completes then throws and exact postcondition is accepted', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf8-t25-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeConfig, { recursive: true });
    const d0 = '{"operator":true}\n';
    const m0 = '{"appVersion":"2.6.22"}\n';
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"operator":true,"newField":1}\n');
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), d0);
    await fsp.writeFile(metadataPath, m0);
    let cpThrew = false;
    let alternateCalled = false;
    const fsOps = Object.create(fsp);
    fsOps.cp = async (source, destination, options) => {
        const dst = String(destination);
        if (dst.includes('.mcbot-config-restore-alt-')) alternateCalled = true;
        if (!cpThrew && dst.includes('.mcbot-config-restore-') && !dst.includes('-alt-')) {
            await fsp.cp(source, destination, options);
            cpThrew = true;
            const error = new Error('RF8 T25 cp post-side-effect EIO'); error.code = 'EIO'; throw error;
        }
        return fsp.cp(source, destination, options);
    };
    const migrator = new RuntimeConfigMigrator({
        templateRoot, runtimeRoot, appVersion: '2.6.23', fsOps,
        migrationRunner: async () => { throw new Error('RF8 T25 original migration failure'); }
    });
    let caught; try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(cpThrew, true);
    assert.equal(alternateCalled, false);
    assert.equal(caught.details.rollback.success, true);
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), d0);
    assert.equal(await fsp.readFile(metadataPath, 'utf8'), m0);
    const attempt = caught.details.rollback.recoveryAttempts.find(x => x.stage === 'initial-verified-stage');
    assert.ok(attempt);
    assert.equal(attempt.callOutcome, 'rejected');
    assert.equal(attempt.causeCode, 'EIO');
    assert.equal(attempt.postcondition, 'copy-threw-postcondition-matched');
});

test('RF8 T26 both failed-prepare cp calls throw after exact copies and alternate exact stage is still usable', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf8-t26-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"x":2}\n');
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), '{"x":1}\n');
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), '{"appVersion":"2.6.22"}\n');
    let cpThrows = 0;
    let initialReadFailures = 0;
    const fsOps = Object.create(fsp);
    fsOps.cp = async (source, destination, options) => {
        const dst = String(destination);
        if (dst.includes('.mcbot-config-restore')) {
            await fsp.cp(source, destination, options);
            cpThrows += 1;
            const error = new Error('RF8 T26 cp post-side-effect EIO'); error.code = 'EIO'; throw error;
        }
        return fsp.cp(source, destination, options);
    };
    fsOps.readFile = async (...args) => {
        const target = String(args[0]);
        if (target.includes('.mcbot-config-restore-') && !target.includes('-alt-') && initialReadFailures < 2) {
            initialReadFailures += 1;
            const error = new Error('RF8 T26 initial stage verify EIO'); error.code = 'EIO'; throw error;
        }
        return fsp.readFile(...args);
    };
    const migrator = new RuntimeConfigMigrator({
        templateRoot, runtimeRoot, appVersion: '2.6.23', fsOps,
        migrationRunner: async () => { throw new Error('RF8 T26 original migration failure'); }
    });
    let caught; try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(cpThrows, 2);
    assert.equal(caught.details.rollback.success, true);
    const attempts = caught.details.rollback.recoveryAttempts;
    assert.ok(attempts.some(x => x.stage === 'initial-verified-stage' && x.callOutcome === 'rejected' && x.success === false));
    assert.ok(attempts.some(x => x.stage === 'alternate-verified-stage' && x.callOutcome === 'rejected' && x.success === true));
});

test('RF8 T27 fallback config recovery cp completes then throws and matched stage continues recovery', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf8-t27-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    const c0 = '{"value":"C0"}\n';
    const m0 = '{"appVersion":"2.6.22","lastBackup":' + JSON.stringify(backup) + '}\n';
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), c0);
    await fsp.writeFile(path.join(backup, 'settings.json'), '{"value":"B"}\n');
    await fsp.writeFile(metadataPath, m0);
    let metadataFailed = false;
    let recoveryCpThrew = false;
    let recoveryRoot = null;
    const fsOps = Object.create(fsp);
    fsOps.mkdtemp = async prefix => {
        const root = await fsp.mkdtemp(prefix);
        if (String(prefix).includes('.mcbot-explicit-rollback-recovery-')) recoveryRoot = root;
        return root;
    };
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!metadataFailed && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            metadataFailed = true;
            throw new Error('RF8 T27 original rollback metadata failure');
        }
        return fsp.rename(source, destination);
    };
    fsOps.cp = async (source, destination, options) => {
        const dst = String(destination);
        if (!recoveryCpThrew && recoveryRoot && path.resolve(dst) === path.resolve(path.join(recoveryRoot, 'config'))) {
            await fsp.cp(source, destination, options);
            recoveryCpThrew = true;
            const error = new Error('RF8 T27 recovery cp EIO'); error.code = 'EIO'; throw error;
        }
        return fsp.cp(source, destination, options);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.23', fsOps });
    let caught; try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(recoveryCpThrew, true);
    assert.equal(caught.recovery?.success, true);
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), c0);
    const attempt = caught.recovery.config.recoveryAttempts.find(x => x.stage === 'stage-prestate-recovery');
    assert.ok(attempt);
    assert.equal(attempt.callOutcome, 'rejected');
    assert.equal(attempt.postcondition, 'copy-threw-postcondition-matched');
});

test('RF8 T28 fallback config recovery accepts correct stage after one transient digest read', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf8-t28-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    const c0 = '{"value":"C0"}\n';
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), c0);
    await fsp.writeFile(path.join(backup, 'settings.json'), '{"value":"B"}\n');
    await fsp.writeFile(metadataPath, '{"appVersion":"2.6.22","lastBackup":' + JSON.stringify(backup) + '}\n');
    let metadataFailed = false;
    let stagedPath = null;
    let recoveryRoot = null;
    let readThrown = false;
    const fsOps = Object.create(fsp);
    fsOps.mkdtemp = async prefix => {
        const root = await fsp.mkdtemp(prefix);
        if (String(prefix).includes('.mcbot-explicit-rollback-recovery-')) recoveryRoot = root;
        return root;
    };
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!metadataFailed && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            metadataFailed = true;
            throw new Error('RF8 T28 original rollback metadata failure');
        }
        return fsp.rename(source, destination);
    };
    fsOps.cp = async (source, destination, options) => {
        if (recoveryRoot && path.resolve(String(destination)) === path.resolve(path.join(recoveryRoot, 'config'))) stagedPath = String(destination);
        return fsp.cp(source, destination, options);
    };
    fsOps.readFile = async (...args) => {
        if (stagedPath && !readThrown && String(args[0]).startsWith(stagedPath + path.sep)) {
            readThrown = true;
            const error = new Error('RF8 T28 transient stage EIO'); error.code = 'EIO'; throw error;
        }
        return fsp.readFile(...args);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.23', fsOps });
    let caught; try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(readThrown, true);
    assert.equal(caught.recovery?.success, true);
    const reads = caught.recovery.config.recoveryAttempts.filter(x => x.stage === 'stage-prestate-recovery-verify');
    assert.equal(reads.length, 2);
    assert.equal(reads[0].causeCode, 'EIO');
    assert.equal(reads[1].success, true);
});

test('RF8 T29 metadata recovery-source write completes then throws and exact source is marked verified', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf8-t29-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    const m0 = '{"appVersion":"2.6.22","lastBackup":' + JSON.stringify(backup) + ',"marker":"M0"}\n';
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), '{"value":"C0"}\n');
    await fsp.writeFile(path.join(backup, 'settings.json'), '{"value":"B"}\n');
    await fsp.writeFile(metadataPath, m0);
    let commitFailed = false;
    let restoreCorrupted = false;
    let sourceWriteThrown = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!commitFailed && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            await fsp.rename(source, destination);
            commitFailed = true;
            throw new Error('RF8 T29 commit post-rename failure');
        }
        const result = await fsp.rename(source, destination);
        if (!restoreCorrupted && destination === metadataPath && src.includes('.restore-rollback-')) {
            await fsp.writeFile(metadataPath, '{"corrupt":true}\n');
            restoreCorrupted = true;
        }
        return result;
    };
    fsOps.writeFile = async (target, ...rest) => {
        if (!sourceWriteThrown && String(target).includes('.restore-source-')) {
            await fsp.writeFile(target, ...rest);
            sourceWriteThrown = true;
            const error = new Error('RF8 T29 source write EIO'); error.code = 'EIO'; throw error;
        }
        return fsp.writeFile(target, ...rest);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.23', fsOps });
    let caught; try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(caught.code, 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED');
    assert.equal(sourceWriteThrown, true);
    assert.equal(caught.details.metadataRecoverySourceVerified, true);
    assert.ok(caught.details.metadataRecoverySourcePath && fs.existsSync(caught.details.metadataRecoverySourcePath));
    const bytes = await fsp.readFile(caught.details.metadataRecoverySourcePath);
    assert.equal(sha256Bytes(bytes), caught.details.metadataExpectedDigest);
    assert.ok(caught.details.metadataRecoveryAttempts.some(x => x.postcondition === 'write-threw-postcondition-matched' && x.causeCode === 'EIO'));
});

test('RF8 T30 metadata recovery-source transient first digest read still proves verified evidence with bounded retry', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf8-t30-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), '{"value":"C0"}\n');
    await fsp.writeFile(path.join(backup, 'settings.json'), '{"value":"B"}\n');
    await fsp.writeFile(metadataPath, '{"appVersion":"2.6.22","lastBackup":' + JSON.stringify(backup) + '}\n');
    let commitFailed = false;
    let restoreCorrupted = false;
    let sourceReadThrown = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!commitFailed && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            await fsp.rename(source, destination);
            commitFailed = true;
            throw new Error('RF8 T30 commit post-rename failure');
        }
        const result = await fsp.rename(source, destination);
        if (!restoreCorrupted && destination === metadataPath && src.includes('.restore-rollback-')) {
            await fsp.writeFile(metadataPath, '{"corrupt":true}\n');
            restoreCorrupted = true;
        }
        return result;
    };
    fsOps.readFile = async (...args) => {
        const target = String(args[0]);
        if (!sourceReadThrown && target.includes('.restore-source-')) {
            sourceReadThrown = true;
            const error = new Error('RF8 T30 source digest EIO'); error.code = 'EIO'; throw error;
        }
        return fsp.readFile(...args);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.23', fsOps });
    let caught; try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(caught.code, 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED');
    assert.equal(sourceReadThrown, true);
    assert.equal(caught.details.metadataRecoverySourceVerified, true);
    const reads = caught.details.metadataRecoveryAttempts.filter(x =>
        x.stage.includes('metadata-restore-source-recreate-verify'));
    assert.ok(reads.length <= 3);
    assert.ok(reads.some(x => x.causeCode === 'EIO'));
    assert.ok(reads.some(x => x.success === true));
});

test('RF8 T31 legacy failed-path collision is never targeted because displacement lives in an operation-owned root', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf8-t31-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"x":2}\n');
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), '{"x":1}\n');
    await fsp.writeFile(metadataPath, '{"appVersion":"2.6.22"}\n');
    const collision = `${runtimeConfig}.failed-${process.pid}-unowned-sentinel`;
    await fsp.mkdir(collision, { recursive: true });
    await fsp.writeFile(path.join(collision, 'sentinel.txt'), 'UNOWNED');
    const rmTargets = [];
    let primaryFailed = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        if (!primaryFailed && String(source) === runtimeConfig && String(destination).includes('.mcbot-failed-prepare-displaced-')) {
            primaryFailed = true;
            const error = new Error('RF8 T31 primary displacement EPERM'); error.code = 'EPERM'; throw error;
        }
        return fsp.rename(source, destination);
    };
    fsOps.rm = async (target, options) => { rmTargets.push(String(target)); return fsp.rm(target, options); };
    const migrator = new RuntimeConfigMigrator({
        templateRoot, runtimeRoot, appVersion: '2.6.23', fsOps,
        migrationRunner: async () => {
            await fsp.writeFile(path.join(runtimeConfig, 'side-effect.json'), '{"D1":true}\n');
            throw new Error('RF8 T31 original migration failure');
        }
    });
    let caught; try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(caught.details.rollback.success, true);
    assert.equal(await fsp.readFile(path.join(collision, 'sentinel.txt'), 'utf8'), 'UNOWNED');
    assert.equal(rmTargets.includes(collision), false);
    const displace = caught.details.rollback.recoveryAttempts.find(x => x.stage === 'displace-active');
    assert.ok(displace);
    assert.equal(displace.destinationOwned, false);
    assert.equal(displace.destinationExists, false);
    assert.ok(displace.destinationPath.includes('.mcbot-failed-prepare-displaced-'));
    const ownedFallback = caught.details.rollback.recoveryAttempts.find(x => x.stage === 'displace-nonprestate-active' && x.success === true);
    assert.ok(ownedFallback && ownedFallback.destinationOwned === true);
});

test('RF8 T32 current-absent explicit rollback never cleans an unowned legacy rollback-current collision', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf8-t32-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(backup, { recursive: true });
    await fsp.mkdir(runtimeRoot, { recursive: true });
    await fsp.writeFile(path.join(backup, 'settings.json'), '{"value":"B"}\n');
    await fsp.writeFile(metadataPath, '{"appVersion":"2.6.22","lastBackup":' + JSON.stringify(backup) + '}\n');
    const collision = `${runtimeConfig}.rollback-current-${process.pid}-unowned-sentinel`;
    await fsp.mkdir(collision, { recursive: true });
    await fsp.writeFile(path.join(collision, 'sentinel.txt'), 'UNOWNED');
    const rmTargets = [];
    const fsOps = Object.create(fsp);
    fsOps.rm = async (target, options) => { rmTargets.push(String(target)); return fsp.rm(target, options); };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.23', fsOps });
    const result = await migrator.rollbackLastConfig();
    assert.ok(result.restoredFrom);
    assert.equal(await fsp.readFile(path.join(runtimeConfig, 'settings.json'), 'utf8'), '{"value":"B"}\n');
    assert.equal(await fsp.readFile(path.join(collision, 'sentinel.txt'), 'utf8'), 'UNOWNED');
    assert.equal(rmTargets.includes(collision), false);
});

test('RF8 T33 fatal recovery retains verified source and never cleans an unowned legacy collision', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf8-t33-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"x":2}\n');
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), '{"x":1}\n');
    await fsp.writeFile(metadataPath, '{"appVersion":"2.6.22"}\n');
    const collision = `${runtimeConfig}.failed-${process.pid}-unowned-sentinel`;
    await fsp.mkdir(collision, { recursive: true });
    await fsp.writeFile(path.join(collision, 'sentinel.txt'), 'UNOWNED');
    const rmTargets = [];
    const fsOps = Object.create(fsp);
    fsOps.cp = async (source, destination, options) => {
        if (String(destination).includes('.mcbot-config-restore') || String(destination).includes('.mcbot-prepare-joint-closure-')) {
            const error = new Error('RF8 T33 recovery stage denied'); error.code = 'EPERM'; throw error;
        }
        return fsp.cp(source, destination, options);
    };
    fsOps.rm = async (target, options) => { rmTargets.push(String(target)); return fsp.rm(target, options); };
    const migrator = new RuntimeConfigMigrator({
        templateRoot, runtimeRoot, appVersion: '2.6.23', fsOps,
        migrationRunner: async () => {
            await fsp.writeFile(path.join(runtimeConfig, 'side-effect.json'), '{\"D1\":true}\n');
            throw new Error('RF8 T33 original migration failure');
        }
    });
    let caught; try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(caught.code, 'RUNTIME_CONFIG_RECOVERY_FAILED');
    assert.equal(caught.details.rollback.success, false);
    assert.ok(caught.details.verifiedRollbackSource && fs.existsSync(caught.details.verifiedRollbackSource));
    assert.equal(await fsp.readFile(path.join(collision, 'sentinel.txt'), 'utf8'), 'UNOWNED');
    assert.equal(rmTargets.includes(collision), false);
});

test('RF8 T34 cp reject-before-side-effect records complete stage evidence without claiming nonexistent destination', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf8-t34-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"x":2}\n');
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), '{"x":1}\n');
    await fsp.writeFile(path.join(runtimeRoot, '.mcbot-runtime.json'), '{"appVersion":"2.6.22"}\n');
    const fsOps = Object.create(fsp);
    fsOps.cp = async (source, destination, options) => {
        if (String(destination).includes('.mcbot-config-restore') || String(destination).includes('.mcbot-prepare-joint-closure-')) {
            const error = new Error('RF8 T34 cp rejected before side effect'); error.code = 'EACCES'; throw error;
        }
        return fsp.cp(source, destination, options);
    };
    const migrator = new RuntimeConfigMigrator({
        templateRoot, runtimeRoot, appVersion: '2.6.23', fsOps,
        migrationRunner: async () => {
            await fsp.writeFile(path.join(runtimeConfig, 'side-effect.json'), '{\"D1\":true}\n');
            throw new Error('RF8 T34 original migration failure');
        }
    });
    let caught; try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(caught.code, 'RUNTIME_CONFIG_RECOVERY_FAILED');
    const attempts = caught.details.rollback.recoveryAttempts.filter(x => x.operation === 'cp');
    assert.ok(attempts.length >= 2);
    for (const attempt of attempts) {
        assert.equal(attempt.callOutcome, 'rejected');
        assert.equal(attempt.causeCode, 'EACCES');
        assert.ok(attempt.sourcePath);
        assert.ok(attempt.destinationPath);
        assert.equal(attempt.destinationExists, false);
        assert.equal(attempt.destinationOwned, false);
        assert.equal(attempt.destinationNamespaceOwned, true);
        assert.equal(fs.existsSync(attempt.destinationPath), false);
    }
    assert.ok(caught.details.verifiedRollbackSource && fs.existsSync(caught.details.verifiedRollbackSource));
});

test('RF8 T35 unreadable final joint config is distinct from absent/mismatched and preserves stable recovery failure', async t => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-rf8-t35-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    await fsp.writeFile(path.join(runtimeConfig, 'settings.json'), '{"value":"C0"}\n');
    await fsp.writeFile(path.join(backup, 'settings.json'), '{"value":"B"}\n');
    await fsp.writeFile(metadataPath, '{"appVersion":"2.6.22","lastBackup":' + JSON.stringify(backup) + '}\n');
    let metadataFailed = false;
    let forceUnreadable = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!metadataFailed && destination === metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            metadataFailed = true;
            throw new Error('RF8 T35 original rollback metadata failure');
        }
        return fsp.rename(source, destination);
    };
    fsOps.mkdtemp = async prefix => {
        if (String(prefix).includes('.mcbot-explicit-rollback-recovery-')) {
            forceUnreadable = true;
            const error = new Error('RF8 T35 recovery root denied'); error.code = 'EPERM'; throw error;
        }
        return fsp.mkdtemp(prefix);
    };
    fsOps.readdir = async (...args) => {
        if (forceUnreadable && String(args[0]) === runtimeConfig) {
            const error = new Error('RF8 T35 active config unreadable'); error.code = 'EIO'; throw error;
        }
        return fsp.readdir(...args);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.23', fsOps });
    let caught; try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(caught.code, 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED');
    assert.equal(caught.details.jointGate.success, false);
    assert.equal(caught.details.jointGate.config.exists, true);
    assert.equal(caught.details.jointGate.config.state, 'unreadable');
    assert.equal(caught.details.jointGate.config.readError.code, 'EIO');
    assert.equal(caught.details.closureRepairCount, 1);
    assert.equal(caught.cause?.message, 'RF8 T35 original rollback metadata failure');
    const attempts = caught.details.recoveryAttempts;
    const gate1Reads = attempts.filter(x => x.phase === 'rollback-joint-verify-1');
    const gate2Reads = attempts.filter(x => x.phase === 'rollback-joint-verify-2');
    assert.equal(gate1Reads.length, 2);
    assert.equal(gate2Reads.length, 2);
    assert.ok(gate1Reads.every(x => x.config.state === 'unreadable' && x.config.readError.code === 'EIO'));
    assert.ok(gate2Reads.every(x => x.config.state === 'unreadable' && x.config.readError.code === 'EIO'));
    assert.ok(attempts.some(x => x.phase === 'CLOSURE_REPAIR_ONCE'));
    assert.equal(attempts.some(x => String(x.phase).includes('cleanup')), false);
    assert.ok(caught.details.verifiedSources.some(x => x.verified === true && x.retentionStatus === 'retained'));
    assert.ok(caught.details.rollbackBackup && fs.existsSync(caught.details.rollbackBackup));
});

async function createR9PrepareFixture(t, label = 'fixture') {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `mcbot-r9-${label}-`));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const configFile = path.join(runtimeConfig, 'settings.json');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(path.join(templateRoot, 'config'), { recursive: true });
    await fsp.mkdir(runtimeConfig, { recursive: true });
    const d0 = '{"value":"D0"}\n';
    const m0 = '{  "appVersion" : "2.6.23", "marker" : "M0" }\n';
    await fsp.writeFile(path.join(templateRoot, 'config', 'settings.json'), '{"value":"template","newField":1}\n');
    await fsp.writeFile(configFile, d0);
    await fsp.writeFile(metadataPath, m0);
    return { dir, templateRoot, runtimeRoot, runtimeConfig, configFile, metadataPath, d0, m0 };
}

async function createR9RollbackFixture(t, label = 'fixture') {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `mcbot-r9-${label}-`));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const templateRoot = path.join(dir, 'template');
    const runtimeRoot = path.join(dir, 'runtime');
    const runtimeConfig = path.join(runtimeRoot, 'config');
    const configFile = path.join(runtimeConfig, 'settings.json');
    const backup = path.join(runtimeRoot, 'data', 'backups', 'manual', 'config');
    const metadataPath = path.join(runtimeRoot, '.mcbot-runtime.json');
    await fsp.mkdir(runtimeConfig, { recursive: true });
    await fsp.mkdir(backup, { recursive: true });
    const c0 = '{"value":"C0"}\n';
    const b = '{"value":"B"}\n';
    const m0 = '{  "appVersion" : "2.6.23", "lastBackup" : ' + JSON.stringify(backup) + ', "marker" : "M0" }\n';
    await fsp.writeFile(configFile, c0);
    await fsp.writeFile(path.join(backup, 'settings.json'), b);
    await fsp.writeFile(metadataPath, m0);
    return { dir, templateRoot, runtimeRoot, runtimeConfig, configFile, backup, metadataPath, c0, b, m0 };
}

test('R9 T36 failed prepare helper diagnostic false but authoritative final prestate joint gate is exact', async t => {
    const f = await createR9PrepareFixture(t, 't36');
    let commitThrown = false;
    let restoreInstalled = false;
    let helperReadErrors = 0;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!commitThrown && destination === f.metadataPath && src.includes('.mcbot-runtime.json.tmp-prepare-')) {
            await fsp.rename(source, destination);
            commitThrown = true;
            const error = new Error('T36 original metadata commit rejection'); error.code = 'EIO'; throw error;
        }
        const result = await fsp.rename(source, destination);
        if (destination === f.metadataPath && src.includes('.mcbot-runtime.json.restore-prepare-')) restoreInstalled = true;
        return result;
    };
    fsOps.readFile = async (...args) => {
        if (restoreInstalled && String(args[0]) === f.metadataPath && helperReadErrors < 2) {
            helperReadErrors += 1;
            const error = new Error('T36 transient helper metadata EIO'); error.code = 'EIO'; throw error;
        }
        return fsp.readFile(...args);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.24', fsOps });
    let caught; try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(commitThrown, true);
    assert.equal(helperReadErrors, 2);
    assert.equal(caught.cause?.message, 'T36 original metadata commit rejection');
    assert.equal(caught.details.rollback.success, true);
    assert.equal(caught.details.rollback.closureRepairCount, 0);
    assert.equal(caught.details.rollback.jointGate.success, true);
    assert.equal(caught.details.rollback.metadata.success, false);
    assert.equal(await fsp.readFile(f.configFile, 'utf8'), f.d0);
    assert.equal(await fsp.readFile(f.metadataPath, 'utf8'), f.m0);
    assert.ok(caught.details.rollback.recoveryAttempts.filter(x => x.causeCode === 'EIO').length >= 2);
});

test('R9 T37 explicit rollback helper diagnostic false but final prestate joint gate remains authoritative', async t => {
    const f = await createR9RollbackFixture(t, 't37');
    let commitThrown = false;
    let restoreInstalled = false;
    let helperReadErrors = 0;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!commitThrown && destination === f.metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            await fsp.rename(source, destination);
            commitThrown = true;
            const error = new Error('T37 original rollback metadata rejection'); error.code = 'EIO'; throw error;
        }
        const result = await fsp.rename(source, destination);
        if (destination === f.metadataPath && src.includes('.mcbot-runtime.json.restore-rollback-')) restoreInstalled = true;
        return result;
    };
    fsOps.readFile = async (...args) => {
        if (restoreInstalled && String(args[0]) === f.metadataPath && helperReadErrors < 2) {
            helperReadErrors += 1;
            const error = new Error('T37 transient helper metadata EIO'); error.code = 'EIO'; throw error;
        }
        return fsp.readFile(...args);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.24', fsOps });
    let caught; try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(commitThrown, true);
    assert.equal(helperReadErrors, 2);
    assert.equal(caught.recovery?.success, true);
    assert.equal(caught.recovery?.closureRepairCount, 0);
    assert.equal(caught.recovery?.jointGate?.success, true);
    assert.equal(await fsp.readFile(f.configFile, 'utf8'), f.c0);
    assert.equal(await fsp.readFile(f.metadataPath, 'utf8'), f.m0);
});

test('R9 T38 failed prepare primary config recovery failure does not block one closure repair', async t => {
    const f = await createR9PrepareFixture(t, 't38');
    let primaryRootsDenied = 0;
    const fsOps = Object.create(fsp);
    fsOps.mkdtemp = async prefix => {
        if (String(prefix).includes('.mcbot-config-restore-')) {
            primaryRootsDenied += 1;
            const error = new Error('T38 primary recovery root denied'); error.code = 'EPERM'; throw error;
        }
        return fsp.mkdtemp(prefix);
    };
    const migrator = new RuntimeConfigMigrator({
        templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.24', fsOps,
        migrationRunner: async () => { throw new Error('T38 original migration failure'); }
    });
    let caught; try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(primaryRootsDenied, 2);
    assert.equal(caught.details.rollback.success, true);
    assert.equal(caught.details.rollback.closureRepairCount, 1);
    assert.equal(caught.details.rollback.jointGate.success, true);
    assert.equal(await fsp.readFile(f.configFile, 'utf8'), f.d0);
    assert.equal(await fsp.readFile(f.metadataPath, 'utf8'), f.m0);
});

test('R9 T39 explicit rollback primary recovery root failure does not block one closure repair', async t => {
    const f = await createR9RollbackFixture(t, 't39');
    let metadataFailed = false;
    let primaryDenied = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!metadataFailed && destination === f.metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            metadataFailed = true;
            throw new Error('T39 original rollback metadata failure');
        }
        return fsp.rename(source, destination);
    };
    fsOps.mkdtemp = async prefix => {
        if (!primaryDenied && String(prefix).includes('.mcbot-explicit-rollback-recovery-')) {
            primaryDenied = true;
            const error = new Error('T39 primary config recovery denied'); error.code = 'EPERM'; throw error;
        }
        return fsp.mkdtemp(prefix);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.24', fsOps });
    let caught; try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(primaryDenied, true);
    assert.equal(caught.recovery?.success, true);
    assert.equal(caught.recovery?.closureRepairCount, 1);
    assert.equal(caught.recovery?.jointGate?.success, true);
    assert.equal(await fsp.readFile(f.configFile, 'utf8'), f.c0);
    assert.equal(await fsp.readFile(f.metadataPath, 'utf8'), f.m0);
});

test('R9 T40 normal prepare desired joint gate catches config mutation during metadata commit and recovers prestate', async t => {
    const f = await createR9PrepareFixture(t, 't40');
    let sabotaged = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const result = await fsp.rename(source, destination);
        if (!sabotaged && destination === f.metadataPath && String(source).includes('.mcbot-runtime.json.tmp-prepare-')) {
            sabotaged = true;
            await fsp.writeFile(f.configFile, '{"value":"D2"}\n');
        }
        return result;
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.24', fsOps });
    let caught; try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(sabotaged, true);
    assert.equal(caught.details.desiredJointGate.success, false);
    assert.equal(caught.details.desiredJointGate.config.state, 'mismatched');
    assert.equal(caught.details.rollback.success, true);
    assert.equal(await fsp.readFile(f.configFile, 'utf8'), f.d0);
    assert.equal(await fsp.readFile(f.metadataPath, 'utf8'), f.m0);
});

test('R9 T41 normal explicit rollback desired joint gate catches config mutation during metadata commit and recovers prestate', async t => {
    const f = await createR9RollbackFixture(t, 't41');
    let sabotaged = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const result = await fsp.rename(source, destination);
        if (!sabotaged && destination === f.metadataPath && String(source).includes('.mcbot-runtime.json.tmp-rollback-')) {
            sabotaged = true;
            await fsp.writeFile(f.configFile, '{"value":"C2"}\n');
        }
        return result;
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.24', fsOps });
    let caught; try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(sabotaged, true);
    assert.equal(caught.code, 'RUNTIME_CONFIG_JOINT_COMMIT_FAILED');
    assert.equal(caught.recovery?.success, true);
    assert.equal(await fsp.readFile(f.configFile, 'utf8'), f.c0);
    assert.equal(await fsp.readFile(f.metadataPath, 'utf8'), f.m0);
});

test('R9 T42 originally absent metadata never deletes an exact-digest unowned active collision', async t => {
    const f = await createR9PrepareFixture(t, 't42');
    await fsp.rm(f.metadataPath, { force: true });
    const rmTargets = [];
    let collisionCreated = false;
    let intendedBytes = null;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        if (!collisionCreated && destination === f.metadataPath && String(source).includes('.mcbot-runtime.json.tmp-prepare-')) {
            intendedBytes = await fsp.readFile(source);
            await fsp.writeFile(f.metadataPath, intendedBytes);
            collisionCreated = true;
            const error = new Error('T42 rename rejected before operation side effect'); error.code = 'EACCES'; throw error;
        }
        return fsp.rename(source, destination);
    };
    fsOps.rm = async (target, options) => { rmTargets.push(String(target)); return fsp.rm(target, options); };
    const migrator = new RuntimeConfigMigrator({ templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.24', fsOps });
    let caught; try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(collisionCreated, true);
    assert.equal(caught.code, 'RUNTIME_CONFIG_RECOVERY_FAILED');
    assert.equal(rmTargets.includes(f.metadataPath), false);
    assert.deepEqual(await fsp.readFile(f.metadataPath), intendedBytes);
    assert.ok(caught.details.transaction.unownedCollisions.some(x => x.path === path.resolve(f.metadataPath) && x.cleanupAttempted === false));
    assert.ok(caught.details.transaction.verifiedSources.some(x => x.owned === true && x.retentionStatus === 'retained'));
});

test('R9 T43 generated metadata temp and recovery-source paths live under an operation-owned root and never overwrite legacy siblings', async t => {
    const f = await createR9RollbackFixture(t, 't43');
    const legacySentinel = `${f.metadataPath}.restore-source-legacy-collision.tmp`;
    await fsp.writeFile(legacySentinel, 'UNOWNED-SENTINEL');
    let txRoot = null;
    let commitFailed = false;
    let restoreCorrupted = false;
    const generatedWrites = [];
    const fsOps = Object.create(fsp);
    fsOps.mkdtemp = async prefix => {
        const root = await fsp.mkdtemp(prefix);
        if (!txRoot && String(prefix).includes('.mcbot-runtime-config-tx-')) txRoot = root;
        return root;
    };
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!commitFailed && destination === f.metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            await fsp.rename(source, destination);
            commitFailed = true;
            const error = new Error('T43 commit rejection'); error.code = 'EIO'; throw error;
        }
        const result = await fsp.rename(source, destination);
        if (!restoreCorrupted && destination === f.metadataPath && src.includes('.mcbot-runtime.json.restore-rollback-')) {
            restoreCorrupted = true;
            await fsp.writeFile(f.metadataPath, '{"corrupt":true}\n');
        }
        return result;
    };
    fsOps.writeFile = async (target, ...rest) => {
        const value = String(target);
        if (value.includes('.mcbot-runtime.json.tmp-') || value.includes('.mcbot-runtime.json.restore-')) generatedWrites.push(value);
        return fsp.writeFile(target, ...rest);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.24', fsOps });
    try { await migrator.rollbackLastConfig(); } catch (_) {}
    assert.ok(txRoot);
    assert.ok(generatedWrites.length >= 2);
    assert.ok(generatedWrites.every(target => path.resolve(target).startsWith(`${path.resolve(txRoot)}${path.sep}`)));
    assert.equal(await fsp.readFile(legacySentinel, 'utf8'), 'UNOWNED-SENTINEL');
});

test('R9 T44 reachable recovery stage uses exact rejected-copy postcondition without a later fallback', async t => {
    const f = await createR9RollbackFixture(t, 't44');
    let metadataFailed = false;
    let recoveryRoot = null;
    let copyRejected = false;
    const createdRoots = [];
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        if (!metadataFailed && destination === f.metadataPath && String(source).includes('.mcbot-runtime.json.tmp-rollback-')) {
            metadataFailed = true;
            throw new Error('T44 original metadata failure');
        }
        return fsp.rename(source, destination);
    };
    fsOps.mkdtemp = async prefix => {
        const root = await fsp.mkdtemp(prefix);
        createdRoots.push({ prefix: String(prefix), root });
        if (String(prefix).includes('.mcbot-explicit-rollback-recovery-')) recoveryRoot = root;
        return root;
    };
    fsOps.cp = async (source, destination, options) => {
        if (!copyRejected && recoveryRoot && path.resolve(String(destination)) === path.resolve(path.join(recoveryRoot, 'config'))) {
            await fsp.cp(source, destination, options);
            copyRejected = true;
            const error = new Error('T44 cp reject after exact copy'); error.code = 'EIO'; throw error;
        }
        return fsp.cp(source, destination, options);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.24', fsOps });
    let caught; try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(copyRejected, true);
    assert.equal(caught.recovery?.success, true);
    const post = caught.recovery.attempts.find(x => x.stage === 'stage-prestate-recovery' && x.callOutcome === 'rejected');
    assert.ok(post);
    assert.equal(post.postcondition, 'copy-threw-postcondition-matched');
    assert.equal(await fsp.readFile(f.configFile, 'utf8'), f.c0);
    assert.equal(createdRoots.some(x => x.prefix.includes('.mcbot-explicit-rollback-joint-closure-')), false);
});

test('R9 T45 successful failed-prepare fallback cleanup removes every success-policy owned disposable after final gate', async t => {
    const f = await createR9PrepareFixture(t, 't45');
    let primaryInstallFailed = false;
    const createdRecoveryRoots = [];
    const fsOps = Object.create(fsp);
    fsOps.mkdtemp = async prefix => {
        const root = await fsp.mkdtemp(prefix);
        createdRecoveryRoots.push(root);
        return root;
    };
    fsOps.rename = async (source, destination) => {
        if (!primaryInstallFailed && destination === f.runtimeConfig && String(source).includes('.mcbot-config-restore-')) {
            primaryInstallFailed = true;
            throw new Error('T45 primary D0 install failure');
        }
        return fsp.rename(source, destination);
    };
    const migrator = new RuntimeConfigMigrator({
        templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.24', fsOps,
        migrationRunner: async () => { throw new Error('T45 original migration failure'); }
    });
    let caught; try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(primaryInstallFailed, true);
    assert.equal(caught.details.rollback.success, true);
    assert.equal(caught.details.rollback.jointGate.success, true);
    assert.ok(createdRecoveryRoots.length >= 1);
    assert.ok(createdRecoveryRoots.every(root => !fs.existsSync(root)));
    const successArtifacts = caught.details.transaction.artifacts.filter(x => x.cleanupPolicy === 'success');
    assert.ok(successArtifacts.length >= 1);
    assert.ok(successArtifacts.every(x => x.retentionStatus === 'cleaned' || x.retentionStatus === 'not-created'));
    assert.ok(createdRecoveryRoots.every(root =>
        caught.details.transaction.artifacts.some(x => path.resolve(x.path) === path.resolve(root))));
});

test('R9 T46 fatal recovery retains verified owned evidence and explicitly refuses cleanup of unowned metadata collision', async t => {
    const f = await createR9PrepareFixture(t, 't46');
    await fsp.rm(f.metadataPath, { force: true });
    const rmTargets = [];
    let collisionCreated = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        if (!collisionCreated && destination === f.metadataPath && String(source).includes('.mcbot-runtime.json.tmp-prepare-')) {
            const bytes = await fsp.readFile(source);
            await fsp.writeFile(f.metadataPath, bytes);
            collisionCreated = true;
            const error = new Error('T46 unowned metadata collision'); error.code = 'EACCES'; throw error;
        }
        return fsp.rename(source, destination);
    };
    fsOps.rm = async (target, options) => { rmTargets.push(String(target)); return fsp.rm(target, options); };
    const migrator = new RuntimeConfigMigrator({ templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.24', fsOps });
    let caught; try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(caught.code, 'RUNTIME_CONFIG_RECOVERY_FAILED');
    assert.ok(caught.details.transaction.verifiedSources.some(x => x.owned === true && x.verified === true && x.retentionStatus === 'retained'));
    assert.ok(caught.details.transaction.unownedCollisions.some(x => x.path === path.resolve(f.metadataPath) && x.cleanupAttempted === false));
    assert.equal(rmTargets.includes(f.metadataPath), false);
});

test('R9 T47 a single chronological ledger orders primary recovery, gate, one closure, final gate and cleanup', async t => {
    const f = await createR9PrepareFixture(t, 't47');
    let commitFailed = false;
    let restoreSabotaged = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!commitFailed && destination === f.metadataPath && src.includes('.mcbot-runtime.json.tmp-prepare-')) {
            await fsp.rename(source, destination);
            commitFailed = true;
            throw new Error('T47 original commit rejection');
        }
        const result = await fsp.rename(source, destination);
        if (!restoreSabotaged && destination === f.metadataPath && src.includes('.mcbot-runtime.json.restore-prepare-')) {
            restoreSabotaged = true;
            await fsp.writeFile(f.configFile, '{"value":"D1-again"}\n');
        }
        return result;
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.24', fsOps });
    let caught; try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(caught.details.rollback.success, true);
    assert.equal(caught.details.rollback.closureRepairCount, 1);
    const attempts = caught.details.rollback.recoveryAttempts;
    assert.deepEqual(attempts.map(x => x.sequence), attempts.map((_, index) => index + 1));
    const first = predicate => attempts.find(predicate)?.sequence ?? Infinity;
    const primaryConfigSeq = first(x => x.phase === 'PRIMARY_CONFIG_RECOVERY');
    const primaryMetadataSeq = first(x => x.phase === 'PRIMARY_METADATA_RECOVERY');
    const gate1Seq = first(x => x.phase === 'prepare-joint-verify-1');
    const closureSeq = first(x => x.phase === 'CLOSURE_REPAIR_ONCE');
    const gate2Seq = first(x => x.phase === 'prepare-joint-verify-2');
    const cleanupSeq = first(x => String(x.phase).includes('cleanup'));
    for (const sequence of [primaryConfigSeq, primaryMetadataSeq, gate1Seq, closureSeq, gate2Seq, cleanupSeq]) {
        assert.notEqual(sequence, Infinity);
    }
    assert.ok(primaryConfigSeq < primaryMetadataSeq);
    assert.ok(primaryMetadataSeq < gate1Seq);
    assert.ok(gate1Seq < closureSeq);
    assert.ok(closureSeq < gate2Seq);
    assert.ok(gate2Seq < cleanupSeq);
});

test('R9 T48 rejected mutation call records precede their postcondition observations for tree and metadata staging', async t => {
    const f = await createR9PrepareFixture(t, 't48');
    let cpRejected = false;
    let metadataCommitFailed = false;
    let restoreCorrupted = false;
    let sourceWriteRejected = false;
    const fsOps = Object.create(fsp);
    fsOps.cp = async (source, destination, options) => {
        if (!cpRejected && String(destination).includes('.mcbot-config-restore-') && !String(destination).includes('-alt-')) {
            await fsp.cp(source, destination, options);
            cpRejected = true;
            const error = new Error('T48 cp reject after side effect'); error.code = 'EIO'; throw error;
        }
        return fsp.cp(source, destination, options);
    };
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!metadataCommitFailed && destination === f.metadataPath && src.includes('.mcbot-runtime.json.tmp-prepare-')) {
            await fsp.rename(source, destination);
            metadataCommitFailed = true;
            throw new Error('T48 commit reject');
        }
        const result = await fsp.rename(source, destination);
        if (!restoreCorrupted && destination === f.metadataPath && src.includes('.restore-prepare-')) {
            restoreCorrupted = true;
            await fsp.writeFile(f.metadataPath, '{"corrupt":true}\n');
        }
        return result;
    };
    fsOps.writeFile = async (target, ...rest) => {
        if (!sourceWriteRejected && String(target).includes('.restore-source-')) {
            await fsp.writeFile(target, ...rest);
            sourceWriteRejected = true;
            const error = new Error('T48 source write reject after side effect'); error.code = 'EIO'; throw error;
        }
        return fsp.writeFile(target, ...rest);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.24', fsOps });
    let caught; try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    const attempts = caught.details.transaction.attempts;
    const cpCall = attempts.find(x => x.stage === 'initial-verified-stage-cp-call' && x.callOutcome === 'rejected');
    const cpObserve = attempts.find(x => x.stage === 'initial-verified-stage-verify');
    assert.ok(cpCall && cpObserve && cpCall.sequence < cpObserve.sequence);
    assert.equal(sourceWriteRejected, true);
    const writeCall = attempts.find(x => x.stage === 'metadata-restore-source-recreate-write-call' && x.callOutcome === 'rejected');
    const writeObserve = attempts.find(x => x.stage === 'metadata-restore-source-recreate-verify');
    assert.ok(writeCall && writeObserve && writeCall.sequence < writeObserve.sequence);
});

test('R9 T49 metadata present-but-unreadable keeps code/message in leaf, joint gate, top-level fatal summary and ledger', async t => {
    const f = await createR9RollbackFixture(t, 't49');
    let commitFailed = false;
    let primaryRestoreDenied = false;
    let closureRestoreSeen = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!commitFailed && destination === f.metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            await fsp.rename(source, destination);
            commitFailed = true;
            throw new Error('T49 original rollback commit rejection');
        }
        if (commitFailed && !primaryRestoreDenied && destination === f.metadataPath
            && src.includes('.mcbot-runtime.json.restore-rollback-')
            && !src.includes('.mcbot-runtime.json.restore-rollback-closure-')) {
            primaryRestoreDenied = true;
            const error = new Error('T49 primary metadata restore denied'); error.code = 'EPERM'; throw error;
        }
        const result = await fsp.rename(source, destination);
        if (destination === f.metadataPath && src.includes('.mcbot-runtime.json.restore-rollback-closure-')) closureRestoreSeen = true;
        return result;
    };
    fsOps.readFile = async (...args) => {
        if (closureRestoreSeen && String(args[0]) === f.metadataPath) {
            const error = new Error('T49 metadata final EIO'); error.code = 'EIO'; throw error;
        }
        return fsp.readFile(...args);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.24', fsOps });
    let caught; try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(caught.code, 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED');
    assert.equal(caught.details.jointGate.metadata.state, 'unreadable');
    assert.equal(caught.details.jointGate.metadata.readError.code, 'EIO');
    assert.equal(caught.details.jointGate.metadata.readError.message, 'T49 metadata final EIO');
    assert.equal(caught.details.metadataActiveReadError.code, 'EIO');
    assert.equal(caught.details.metadataActiveReadError.message, 'T49 metadata final EIO');
    const eioAttempt = caught.details.recoveryAttempts.find(x => x.causeCode === 'EIO' && /metadata/i.test(x.operation || x.stage || ''));
    assert.ok(eioAttempt);
    assert.equal(eioAttempt.message, 'T49 metadata final EIO');
    assert.ok(caught.details.recoveryDiagnostics.some(x =>
        x.metadataActiveReadError?.code === 'EIO'
        && x.metadataActiveReadError?.message === 'T49 metadata final EIO'));
});

test('R9 T50 cp reject-before-side-effect never labels nonexistent stage owned in failed prepare or explicit recovery', async t => {
    const p = await createR9PrepareFixture(t, 't50-prepare');
    const pFs = Object.create(fsp);
    pFs.cp = async (source, destination, options) => {
        const dst = String(destination);
        if (dst.includes('.mcbot-config-restore-') || dst.includes('.mcbot-prepare-joint-closure-')) {
            const error = new Error('T50 prepare cp denied'); error.code = 'EACCES'; throw error;
        }
        return fsp.cp(source, destination, options);
    };
    const pMigrator = new RuntimeConfigMigrator({
        templateRoot: p.templateRoot, runtimeRoot: p.runtimeRoot, appVersion: '2.6.24', fsOps: pFs,
        migrationRunner: async () => { await fsp.writeFile(path.join(p.runtimeConfig, 'side-effect.json'), '{"D1":true}\n'); throw new Error('T50 prepare original'); }
    });
    let pCaught; try { await pMigrator.prepare(); } catch (error) { pCaught = error; }
    assert.ok(pCaught);
    const pAttempts = pCaught.details.transaction.attempts.filter(x => x.operation === 'cp' && x.callOutcome === 'rejected');
    assert.ok(pAttempts.length >= 2);
    assert.ok(pAttempts.every(x => x.destinationExists === false && x.destinationOwned === false && x.destinationNamespaceOwned === true));

    const r = await createR9RollbackFixture(t, 't50-rollback');
    let metadataFailed = false;
    const rFs = Object.create(fsp);
    rFs.rename = async (source, destination) => {
        if (!metadataFailed && destination === r.metadataPath && String(source).includes('.mcbot-runtime.json.tmp-rollback-')) {
            metadataFailed = true;
            throw new Error('T50 rollback metadata failure');
        }
        return fsp.rename(source, destination);
    };
    rFs.cp = async (source, destination, options) => {
        const dst = String(destination);
        if (path.basename(dst) === 'config' && (dst.includes('.mcbot-explicit-rollback-recovery-') || dst.includes('.mcbot-explicit-rollback-joint-closure-'))) {
            const error = new Error('T50 rollback recovery cp denied'); error.code = 'EACCES'; throw error;
        }
        return fsp.cp(source, destination, options);
    };
    const rMigrator = new RuntimeConfigMigrator({ templateRoot: r.templateRoot, runtimeRoot: r.runtimeRoot, appVersion: '2.6.24', fsOps: rFs });
    let rCaught; try { await rMigrator.rollbackLastConfig(); } catch (error) { rCaught = error; }
    assert.ok(rCaught);
    assert.equal(rCaught.code, 'RUNTIME_CONFIG_ROLLBACK_RECOVERY_FAILED');
    const rAttempts = rCaught.details.recoveryAttempts.filter(x => x.operation === 'cp' && x.callOutcome === 'rejected');
    assert.ok(rAttempts.length >= 1);
    assert.ok(rAttempts.every(x => x.destinationExists === false && x.destinationOwned === false && x.destinationNamespaceOwned === true));
});

test('R9 T51 fault hooks are cross-platform and contain no hard-coded POSIX config suffix check', async () => {
    const source = await fsp.readFile(__filename, 'utf8');
    const forbiddenSingle = 'endsWith(' + "'/config'" + ')';
    const forbiddenDouble = 'endsWith(' + '"/config"' + ')';
    assert.equal(source.includes(forbiddenSingle), false);
    assert.equal(source.includes(forbiddenDouble), false);
    assert.equal(path.basename(path.join('root', 'nested', 'config')), 'config');
    assert.equal(path.resolve(path.join('root', 'config')), path.resolve('root', 'config'));
});

test('R9 T52 cleanup rejection after verified desired state is a structured warning and does not reverse commit', async t => {
    const f = await createR9PrepareFixture(t, 't52');
    await fsp.writeFile(f.metadataPath, '{"appVersion":"2.6.24","marker":"M0"}\n');
    let cleanupRejected = false;
    let retainedRoot = null;
    const fsOps = Object.create(fsp);
    fsOps.rm = async (target, options) => {
        if (!cleanupRejected && String(target).includes('.mcbot-runtime-config-tx-')) {
            cleanupRejected = true;
            retainedRoot = String(target);
            const error = new Error('T52 cleanup EBUSY'); error.code = 'EBUSY'; throw error;
        }
        return fsp.rm(target, options);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.24', fsOps });
    const report = await migrator.prepare();
    assert.equal(cleanupRejected, true);
    assert.equal(JSON.parse(await fsp.readFile(f.configFile, 'utf8')).newField, 1);
    assert.equal(JSON.parse(await fsp.readFile(f.metadataPath, 'utf8')).appVersion, '2.6.24');
    assert.ok(report.warnings.some(x => x.code === 'RUNTIME_CONFIG_TRANSACTION_CLEANUP_FAILED'
        && x.path === retainedRoot
        && x.preservedSnapshot === retainedRoot
        && x.kind === 'transaction-root'
        && x.owned === true
        && x.causeCode === 'EBUSY'
        && x.message === 'T52 cleanup EBUSY'));
    assert.equal(fs.existsSync(retainedRoot), true);
});

test('R10 T53 a rollback-current marker in the parent path never makes a durable safety source movable', async t => {
    const f = await createR9RollbackFixture(t, '.rollback-current--t53');
    let displacedCurrent = null;
    let safetyCopy = null;
    let metadataFailed = false;
    const renameCalls = [];
    const fsOps = Object.create(fsp);
    fsOps.cp = async (source, destination, options) => {
        if (String(destination).includes('.before-rollback-')) safetyCopy = String(destination);
        return fsp.cp(source, destination, options);
    };
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        const dst = String(destination);
        renameCalls.push({ source: src, destination: dst });
        if (src === f.runtimeConfig && dst.includes('config.rollback-current-active')) displacedCurrent = dst;
        if (!metadataFailed && destination === f.metadataPath && src.includes('.mcbot-runtime.json.tmp-rollback-')) {
            await fsp.rm(f.runtimeConfig, { recursive: true, force: true });
            if (displacedCurrent) await fsp.rm(displacedCurrent, { recursive: true, force: true });
            metadataFailed = true;
            const error = new Error('T53 original rollback metadata failure'); error.code = 'EIO'; throw error;
        }
        return fsp.rename(source, destination);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.25', fsOps });
    let caught; try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(metadataFailed, true);
    assert.ok(safetyCopy && safetyCopy.includes('.rollback-current-'));
    assert.equal(caught.recovery?.success, true);
    assert.equal(await fsp.readFile(f.configFile, 'utf8'), f.c0);
    assert.equal(fs.existsSync(safetyCopy), true);
    assert.equal(await fsp.readFile(path.join(safetyCopy, 'settings.json'), 'utf8'), f.c0);
    assert.equal(renameCalls.some(call => path.resolve(call.source) === path.resolve(safetyCopy)), false);
    const safetySource = caught.recovery.verifiedSources.find(x => path.resolve(x.path) === path.resolve(safetyCopy));
    assert.ok(safetySource);
    assert.equal(safetySource.movable, false);
});

test('R10 T54 an exact safety-copy collision after rejected cp stays verified but unowned and unconsumed', async t => {
    const f = await createR9RollbackFixture(t, 't54');
    let safetyCopy = null;
    let collisionCreated = false;
    let metadataFailed = false;
    const renameSources = [];
    const rmTargets = [];
    const fsOps = Object.create(fsp);
    fsOps.cp = async (source, destination, options) => {
        if (!collisionCreated && String(destination).includes('.before-rollback-')) {
            safetyCopy = String(destination);
            await fsp.cp(source, destination, { recursive: true, force: false, errorOnExist: true });
            collisionCreated = true;
            const error = new Error('T54 external exact safety collision'); error.code = 'EEXIST'; throw error;
        }
        return fsp.cp(source, destination, options);
    };
    fsOps.rename = async (source, destination) => {
        renameSources.push(String(source));
        if (!metadataFailed && destination === f.metadataPath && String(source).includes('.mcbot-runtime.json.tmp-rollback-')) {
            metadataFailed = true;
            const error = new Error('T54 original rollback metadata failure'); error.code = 'EIO'; throw error;
        }
        return fsp.rename(source, destination);
    };
    fsOps.rm = async (target, options) => { rmTargets.push(String(target)); return fsp.rm(target, options); };
    const migrator = new RuntimeConfigMigrator({ templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.25', fsOps });
    let caught; try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(collisionCreated, true);
    assert.equal(caught.recovery?.success, true);
    const artifact = caught.recovery.artifacts.find(x => path.resolve(x.path) === path.resolve(safetyCopy));
    const source = caught.recovery.verifiedSources.find(x => path.resolve(x.path) === path.resolve(safetyCopy) && x.kind === 'config-prestate');
    assert.ok(artifact && source);
    assert.equal(artifact.verified, true);
    assert.equal(artifact.createdByOperation, false);
    assert.equal(artifact.ownedByThisOperation, false);
    assert.equal(artifact.movable, false);
    assert.equal(artifact.cleanupPolicy, 'retain');
    assert.equal(source.verified, true);
    assert.equal(source.owned, false);
    assert.equal(source.movable, false);
    assert.ok(caught.recovery.unownedCollisions.some(x => path.resolve(x.path) === path.resolve(safetyCopy) && x.cleanupAttempted === false));
    assert.equal(renameSources.some(sourcePath => path.resolve(sourcePath) === path.resolve(safetyCopy)), false);
    assert.equal(rmTargets.some(target => path.resolve(target) === path.resolve(safetyCopy)), false);
    assert.equal(await fsp.readFile(path.join(safetyCopy, 'settings.json'), 'utf8'), f.c0);
});

test('R10 T55 rollback safety copy passes an explicit no-clobber fs.cp contract', async t => {
    const f = await createR9RollbackFixture(t, 't55');
    let captured = null;
    const fsOps = Object.create(fsp);
    fsOps.cp = async (source, destination, options) => {
        if (String(destination).includes('.before-rollback-')) captured = { ...options };
        return fsp.cp(source, destination, options);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.25', fsOps });
    const result = await migrator.rollbackLastConfig();
    assert.ok(result.restoredFrom);
    assert.deepEqual(captured, { recursive: true, force: false, errorOnExist: true });
});

test('R10 T56-A consumed metadata candidate replaced by an external file is not deleted when prestate was absent', async t => {
    const f = await createR9PrepareFixture(t, 't56-absent');
    await fsp.rm(f.metadataPath, { force: true });
    const externalBytes = Buffer.from('{"external":"T56-A"}\n');
    const operationRmTargets = [];
    let replacementInstalled = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (!replacementInstalled && destination === f.metadataPath && src.includes('.mcbot-runtime.json.tmp-prepare-')) {
            await fsp.rename(source, destination);
            await fsp.rm(f.metadataPath, { force: true });
            const external = path.join(f.runtimeRoot, 't56-a-external-metadata');
            await fsp.writeFile(external, externalBytes);
            await fsp.rename(external, f.metadataPath);
            replacementInstalled = true;
            return;
        }
        return fsp.rename(source, destination);
    };
    fsOps.rm = async (target, options) => { operationRmTargets.push(String(target)); return fsp.rm(target, options); };
    const migrator = new RuntimeConfigMigrator({ templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.25', fsOps });
    let caught; try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(replacementInstalled, true);
    assert.equal(caught.code, 'RUNTIME_CONFIG_RECOVERY_FAILED');
    assert.deepEqual(await fsp.readFile(f.metadataPath), externalBytes);
    assert.equal(operationRmTargets.includes(f.metadataPath), false);
    assert.equal(caught.details.transaction.attempts.some(x => x.stage === 'metadata-commit-rename-postcondition' && x.destinationOwned === true), false);
    assert.ok(caught.details.transaction.unownedCollisions.some(x => x.path === path.resolve(f.metadataPath) && x.cleanupAttempted === false));
});

test('R10 T56-B consumed metadata candidate replaced by an external file is not overwritten when prestate existed', async t => {
    const f = await createR9PrepareFixture(t, 't56-present');
    const externalBytes = Buffer.from('{"external":"T56-B"}\n');
    const metadataRestoreSources = [];
    let replacementInstalled = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        const src = String(source);
        if (destination === f.metadataPath && src.includes('.mcbot-runtime.json.restore-')) metadataRestoreSources.push(src);
        if (!replacementInstalled && destination === f.metadataPath && src.includes('.mcbot-runtime.json.tmp-prepare-')) {
            await fsp.rename(source, destination);
            await fsp.rm(f.metadataPath, { force: true });
            const external = path.join(f.runtimeRoot, 't56-b-external-metadata');
            await fsp.writeFile(external, externalBytes);
            await fsp.rename(external, f.metadataPath);
            replacementInstalled = true;
            return;
        }
        return fsp.rename(source, destination);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.25', fsOps });
    let caught; try { await migrator.prepare(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(replacementInstalled, true);
    assert.equal(caught.code, 'RUNTIME_CONFIG_RECOVERY_FAILED');
    assert.deepEqual(await fsp.readFile(f.metadataPath), externalBytes);
    assert.equal(metadataRestoreSources.length, 0);
    assert.ok(caught.details.transaction.verifiedSources.some(x => x.kind === 'metadata-recovery-source' && x.verified === true && x.retentionStatus === 'retained'));
    assert.ok(caught.details.transaction.unownedCollisions.some(x => x.path === path.resolve(f.metadataPath) && x.cleanupAttempted === false));
    assert.equal(caught.details.metadataSnapshot.digest === sha256Bytes(externalBytes), false);
    assert.equal(caught.details.transaction.finalJointGate.metadata.digest, sha256Bytes(externalBytes));
});

test('R10 T57 normal prepare cleanup warning preserves path kind owner cause and message', async t => {
    const f = await createR9PrepareFixture(t, 't57');
    await fsp.writeFile(f.metadataPath, '{"appVersion":"2.6.25","marker":"M0"}\n');
    let retainedRoot = null;
    const fsOps = Object.create(fsp);
    fsOps.rm = async (target, options) => {
        if (!retainedRoot && String(target).includes('.mcbot-runtime-config-tx-')) {
            retainedRoot = String(target);
            const error = new Error('T57 cleanup root busy'); error.code = 'EBUSY'; throw error;
        }
        return fsp.rm(target, options);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.25', fsOps });
    const report = await migrator.prepare();
    const warning = report.warnings.find(x => x.path === retainedRoot);
    assert.ok(warning);
    assert.deepEqual(warning, {
        code: 'RUNTIME_CONFIG_TRANSACTION_CLEANUP_FAILED',
        message: 'T57 cleanup root busy',
        path: retainedRoot,
        preservedSnapshot: retainedRoot,
        kind: 'transaction-root',
        owned: true,
        causeCode: 'EBUSY'
    });
    assert.equal(fs.existsSync(retainedRoot), true);
});

test('R10 T58 rejected recovery cp call precedes digest proof and installs without any closure fallback', async t => {
    const f = await createR9RollbackFixture(t, 't58');
    let metadataFailed = false;
    let recoveryRoot = null;
    let copyRejected = false;
    let closureRootRequested = false;
    const fsOps = Object.create(fsp);
    fsOps.rename = async (source, destination) => {
        if (!metadataFailed && destination === f.metadataPath && String(source).includes('.mcbot-runtime.json.tmp-rollback-')) {
            metadataFailed = true;
            const error = new Error('T58 original metadata failure'); error.code = 'EIO'; throw error;
        }
        return fsp.rename(source, destination);
    };
    fsOps.mkdtemp = async prefix => {
        const value = String(prefix);
        if (value.includes('.mcbot-explicit-rollback-joint-closure-')) {
            closureRootRequested = true;
            const error = new Error('T58 closure fallback forbidden'); error.code = 'EPERM'; throw error;
        }
        const root = await fsp.mkdtemp(prefix);
        if (value.includes('.mcbot-explicit-rollback-recovery-')) recoveryRoot = root;
        return root;
    };
    fsOps.cp = async (source, destination, options) => {
        if (!copyRejected && recoveryRoot && path.resolve(String(destination)) === path.resolve(path.join(recoveryRoot, 'config'))) {
            await fsp.cp(source, destination, options);
            copyRejected = true;
            const error = new Error('T58 exact recovery copy then reject'); error.code = 'EIO'; throw error;
        }
        return fsp.cp(source, destination, options);
    };
    const migrator = new RuntimeConfigMigrator({ templateRoot: f.templateRoot, runtimeRoot: f.runtimeRoot, appVersion: '2.6.25', fsOps });
    let caught; try { await migrator.rollbackLastConfig(); } catch (error) { caught = error; }
    assert.ok(caught);
    assert.equal(copyRejected, true);
    assert.equal(closureRootRequested, false);
    assert.equal(caught.recovery?.success, true);
    const attempts = caught.recovery.attempts;
    const call = attempts.find(x => x.stage === 'stage-prestate-recovery-cp-call' && x.callOutcome === 'rejected');
    const digest = attempts.find(x => x.stage === 'stage-prestate-recovery-verify' && x.success === true);
    const install = attempts.find(x => x.stage === 'install-prestate-recovery-call');
    assert.ok(call && digest && install);
    assert.ok(call.sequence < digest.sequence && digest.sequence < install.sequence);
    assert.equal(await fsp.readFile(f.configFile, 'utf8'), f.c0);
    assert.ok(caught.recovery.verifiedSources.some(x => x.kind === 'config-prestate' && x.verified === true));
});
