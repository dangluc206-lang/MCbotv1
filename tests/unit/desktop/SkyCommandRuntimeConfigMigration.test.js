'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const RuntimeConfigMigrator = require('../../../src/desktop/update/RuntimeConfigMigrator');

async function write(file, value) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

test('runtime config migration adds sky-commands file for existing installs and preserves operator registrations', async () => {
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-skycmd-migrate-'));
    const templateRoot = path.join(base, 'template');
    const runtimeRoot = path.join(base, 'runtime');
    await write(path.join(templateRoot, 'config/commands/sky-commands.json'), { sky1: {}, sky2: {} });
    await write(path.join(runtimeRoot, '.mcbot-runtime.json'), { appVersion: '2.6.11' });
    await write(path.join(runtimeRoot, 'config/commands/commands.json'), { storage: '/kho' });

    let migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.12' });
    let report = await migrator.prepare();
    assert.equal(report.filesAdded >= 1, true);
    assert.deepEqual(JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config/commands/sky-commands.json'), 'utf8')), { sky1: {}, sky2: {} });

    await write(path.join(runtimeRoot, 'config/commands/sky-commands.json'), {
        sky1: { autofarm: { command: '/autofarm', label: 'Auto Farm', description: '', enabled: true } }
    });
    await write(path.join(runtimeRoot, '.mcbot-runtime.json'), { appVersion: '2.6.11' });
    migrator = new RuntimeConfigMigrator({ templateRoot, runtimeRoot, appVersion: '2.6.12' });
    report = await migrator.prepare();
    const current = JSON.parse(await fsp.readFile(path.join(runtimeRoot, 'config/commands/sky-commands.json'), 'utf8'));
    assert.equal(current.sky1.autofarm.command, '/autofarm');
    assert.deepEqual(current.sky2, {});
    assert.equal(report.warnings.length, 0);

    await fsp.rm(base, { recursive: true, force: true });
});
