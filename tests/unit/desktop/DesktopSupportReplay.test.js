'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const DesktopController = require('../../../src/desktop/DesktopController');

test('support bundle includes the latest B5 replay fixture without requiring verbose GUI logs', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-support-replay-'));
    const controller = new DesktopController({ baseDir });
    const fixture = {
        version: 1,
        inspection: { amount: 1, fullPlan: { targetId: 'b5', feasible: false, missing: {}, steps: [] }, chains: [], progress: { targetId: 'b5', amount: 1, feasible: false } },
        expected: { decisionKind: 'WAIT', decisionResource: null, blockers: [] }
    };
    const runtime = {
        botId: 'bot-01',
        context: { get: () => null, getGeneration: () => 0 },
        getState: () => ({ connection: 'DISCONNECTED' }),
        getService: name => {
            if (name === 'b5TraceRecorder') return { latestReplayFixture: () => fixture };
            if (name === 'modeRegistry') return { status: () => ({ modes: [] }) };
            return null;
        }
    };
    controller.bundle = {
        application: {
            listRuntimes: () => [runtime],
            getState: () => 'RUNNING'
        },
        fleetControl: {
            profileSnapshot: () => ({}),
            status: () => null,
            intent: () => null
        },
        botProfileAdmin: { listProfiles: async () => [] },
        configuration: { registry: { require: () => ({ diagnostics: { runtimeFailures: { directory: 'data/runtime/errors', maxFileMb: 8 } } }) } }
    };
    controller.lifecycle = 'RUNNING';
    const oversizedDir = path.join(baseDir, 'data', 'runtime', 'errors', 'bot-01');
    await fs.mkdir(oversizedDir, { recursive: true });
    await fs.writeFile(path.join(oversizedDir, 'last-error.json'), JSON.stringify({ padding: 'x'.repeat(129 * 1024) }), 'utf8');
    const preview = await controller.supportBundlePreview();
    assert.match(preview.previewId, /^support-preview:/);
    assert.ok(preview.warnings.some(entry => entry.code === 'SUPPORT_RUNTIME_FAILURE_OVERSIZE_SKIPPED'));
    const out = await controller.exportSupportBundle({ previewId: preview.previewId });
    const payload = JSON.parse(await fs.readFile(out.path, 'utf8'));
    assert.equal(out.manifestHash, preview.manifestHash, 'the confirmed preview must be the exact exported bundle');
    assert.equal(payload.version, 2);
    const replayEntry = payload.files.find(entry => entry.path.startsWith('evidence/replay-b5-'));
    assert.ok(replayEntry);
    const replay = JSON.parse(replayEntry.content);
    assert.match(replay.botId, /^bot-/);
    assert.notEqual(replay.botId, 'bot-01');
    assert.equal(replay.fixture.version, 1);
    assert.equal(require('../../../src/diagnostics/support/SupportBundleBuilder').validate(payload).valid, true);
    await assert.rejects(controller.exportSupportBundle({ previewId: preview.previewId }), error => error.code === 'SUPPORT_BUNDLE_PREVIEW_EXPIRED');
    await fs.rm(baseDir, { recursive: true, force: true });
});
