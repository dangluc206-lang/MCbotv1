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
        configuration: { registry: { require: () => ({ runtimeFailures: { directory: 'data/runtime/errors' } }) } }
    };
    controller.lifecycle = 'RUNNING';
    const out = await controller.exportSupportBundle();
    const payload = JSON.parse(await fs.readFile(out.path, 'utf8'));
    assert.equal(payload.b5Replays.length, 1);
    assert.equal(payload.b5Replays[0].botId, 'bot-01');
    assert.equal(payload.b5Replays[0].fixture.version, 1);
    await fs.rm(baseDir, { recursive: true, force: true });
});
