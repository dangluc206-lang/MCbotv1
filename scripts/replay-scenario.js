'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const VirtualClock = require('../src/simulation/VirtualClock');
const RuntimeReplayHarness = require('../src/simulation/RuntimeReplayHarness');
const SafetyReplayRuntime = require('../src/simulation/SafetyReplayRuntime');
const Redactor = require('../src/shared/security/Redactor');

function validateScenario(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Replay scenario must be an object.');
    const allowed = new Set(['version', 'name', 'clockStartMs', 'runtime', 'faults', 'entries']);
    for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Unknown replay scenario key: ${key}`);
    if (value.version !== 1) throw new Error(`Unsupported replay scenario version: ${value.version}`);
    if (typeof value.name !== 'string' || !value.name.trim()) throw new Error('Replay scenario name is required.');
    if (!Array.isArray(value.entries)) throw new Error('Replay scenario entries must be an array.');
    if (value.faults !== undefined && !Array.isArray(value.faults)) throw new Error('Replay scenario faults must be an array.');
    return value;
}

async function runScenario(filePath) {
    const absolute = path.resolve(filePath);
    const scenario = validateScenario(JSON.parse(await fs.readFile(absolute, 'utf8')));
    const clock = new VirtualClock({ startMs: Number(scenario.clockStartMs || 0) });
    const harness = new RuntimeReplayHarness({ clock });
    const runtime = new SafetyReplayRuntime({ clock, ...(scenario.runtime || {}) });
    runtime.install(harness);
    try {
        const replay = await harness.replay(scenario.entries, { faults: scenario.faults || [] });
        return Redactor.sanitize({
            scenario: scenario.name,
            source: absolute,
            replay,
            runtime: runtime.snapshot()
        });
    } finally {
        await harness.dispose('Replay scenario complete.');
    }
}

if (require.main === module) {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error('Usage: node scripts/replay-scenario.js <scenario.json>');
        process.exitCode = 1;
    } else {
        runScenario(filePath).then(
            result => console.log(JSON.stringify(result, null, 2)),
            error => {
                console.error(error);
                process.exitCode = 1;
            }
        );
    }
}

module.exports = Object.freeze({ runScenario, validateScenario });
