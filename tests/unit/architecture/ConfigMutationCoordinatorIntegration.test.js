'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const KeyedMutationCoordinator = require('../../../src/core/KeyedMutationCoordinator');
const CollectorB5ConfigEditor = require('../../../src/discord/config/CollectorB5ConfigEditor');
const FishingBotConfigEditor = require('../../../src/discord/config/FishingBotConfigEditor');

const projectRoot = path.resolve(__dirname, '../../..');

async function fixture(t) {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-config-mutation-'));
    t.after(() => fs.rm(baseDir, { recursive: true, force: true }));
    await fs.mkdir(path.join(baseDir, 'config/modes'), { recursive: true });
    await fs.mkdir(path.join(baseDir, 'config/bots'), { recursive: true });
    await fs.cp(path.join(projectRoot, 'config/modes/collector-b5.json'), path.join(baseDir, 'config/modes/collector-b5.json'));
    await fs.cp(path.join(projectRoot, 'config/bots/bot-01.json'), path.join(baseDir, 'config/bots/bot-01.json'));
    const fishing = JSON.parse(await fs.readFile(path.join(projectRoot, 'config/modes/fishing.json'), 'utf8'));
    const configuration = {
        validator: { assertValid() {} },
        crossValidator: { assertValid() {} },
        registry: {
            snapshot: () => ({}),
            require: key => {
                if (key === 'fishingMode') return fishing;
                throw new Error(`unexpected config key ${key}`);
            }
        },
        service: {
            async reload(_key, filePath) {
                return { success: true, data: JSON.parse(await fs.readFile(filePath, 'utf8')) };
            }
        }
    };
    const botRegistry = { get: () => null, ids: () => ['bot-01'], require: () => ({ requireService: () => ({ reconfigure() {} }) }) };
    return { baseDir, configuration, botRegistry, fishing };
}

test('collector config mutations from separate editor instances preserve both concurrent changes', async t => {
    const { baseDir, configuration, botRegistry } = await fixture(t);
    const coordinator = new KeyedMutationCoordinator();
    const make = () => new CollectorB5ConfigEditor({ baseDir, configuration, botRegistry, botId: 'bot-01', mutationCoordinator: coordinator });
    const first = make();
    const second = make();

    await Promise.all([
        first.setPickupLocation({ x: 1, y: 2, z: 3 }),
        second.setCraftLoopDelayMs(777)
    ]);

    const final = JSON.parse(await fs.readFile(path.join(baseDir, 'config/modes/collector-b5.json'), 'utf8'));
    assert.deepEqual(final.pickupLocation, { x: 1, y: 2, z: 3 });
    assert.equal(final.craftLoopDelayMs, 777);
});

test('fishing config mutations from separate editor instances preserve both concurrent area overrides', async t => {
    const { baseDir, configuration, botRegistry, fishing } = await fixture(t);
    const coordinator = new KeyedMutationCoordinator();
    const make = () => new FishingBotConfigEditor({ baseDir, configuration, botRegistry, mutationCoordinator: coordinator });
    const [areaA, areaB] = fishing.areas.slice(1, 3).map(area => area.id);

    await Promise.all([
        make().setAreaPosition({ botId: 'bot-01', areaId: areaA, x: 10, y: 20, z: 30, pitchDegrees: 12 }),
        make().setAreaPosition({ botId: 'bot-01', areaId: areaB, x: 40, y: 50, z: 60, pitchDegrees: 13 })
    ]);

    const final = JSON.parse(await fs.readFile(path.join(baseDir, 'config/bots/bot-01.json'), 'utf8'));
    assert.deepEqual(final.fishing.areas[areaA], { x: 10, y: 20, z: 30 });
    assert.deepEqual(final.fishing.areas[areaB], { x: 40, y: 50, z: 60 });
});


test('generic Desktop and Collector config mutations converge on the shared config-set key', async () => {
    const desktopSource = await fs.readFile(path.join(projectRoot, 'src/desktop/DesktopController.js'), 'utf8');
    const collectorSource = await fs.readFile(path.join(projectRoot, 'src/discord/config/CollectorB5ConfigEditor.js'), 'utf8');
    assert.match(desktopSource, /#configMutation\(work\)[\s\S]*?\.run\('config-set', work\)/);
    assert.match(collectorSource, /#queueMutation\(work\)[\s\S]*?\.run\('config-set', work\)/);
    for (const method of ['upsertSkyCommand','deleteSkyCommand','saveConfigGroup','updateB5RulesConfig','updateB5CraftConfig','updateStorageProtectionConfig','updateSkyAutoJoinConfig']) {
        assert.match(desktopSource, new RegExp(`${method}\\([^)]*\\) \\{ return this\\.#configMutation\\(`), method);
    }
});
