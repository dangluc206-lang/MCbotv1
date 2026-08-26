'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const DesktopController = require('../../../src/desktop/DesktopController');

async function createProjectFixture(t) {
    const baseDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mcbot-desktop-diagnostics-'));
    t.after(() => fsp.rm(baseDir, { recursive: true, force: true }));
    await fsp.mkdir(path.join(baseDir, 'config'), { recursive: true });
    const app = require('../../../config/app.json');
    await fsp.writeFile(path.join(baseDir, 'config', 'app.json'), `${JSON.stringify(app, null, 2)}\n`, 'utf8');
    return baseDir;
}

test('Desktop diagnostics uses actual nested runtime-failure layout while backend is stopped', async t => {
    const baseDir = await createProjectFixture(t);
    const dir = path.join(baseDir, 'data', 'runtime', 'errors', 'bot-01');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'last-error.json'), `${JSON.stringify({
        failureId: 'desktop-fixture',
        botId: 'bot-01',
        code: 'CRAFTING_OUTPUT_NOT_VERIFIED',
        canonicalError: { severity: 'ERROR', correlationId: 'corr-01' },
        occurredAt: '2026-08-24T12:00:00.000Z'
    })}\n`, 'utf8');

    const controller = new DesktopController({ baseDir });
    assert.equal(controller.lifecycle, 'STOPPED');
    const result = controller.diagnostics({ limit: 10 });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].botId, 'bot-01');
    assert.equal(result.items[0].code, 'CRAFTING_OUTPUT_NOT_VERIFIED');
    assert.match(result.items[0].id, /^rfa1\./);

    const read = controller.readDiagnostic(result.items[0].id);
    assert.equal(read.record.failureId, 'desktop-fixture');
    assert.equal(read.artifact.botId, 'bot-01');

    // The repository and validated config contract are cached for the current
    // controller lifecycle instead of reparsing app.json on every UI poll.
    await fsp.unlink(path.join(baseDir, 'config', 'app.json'));
    const cached = controller.diagnostics({ limit: 10 });
    assert.equal(cached.items[0].code, 'CRAFTING_OUTPUT_NOT_VERIFIED');
});
