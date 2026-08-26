'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONTRACT = 'mcbot-runtime-workload-metrics/v1';
const REQUIRED_OPERATIONS = Object.freeze(['gui.click', 'storage.withdraw', 'b5.cycle']);

function validate(snapshot, { minimumLiveSamples = 30 } = {}) {
    const errors = [];
    if (snapshot?.contract !== CONTRACT) errors.push(`contract must be ${CONTRACT}`);
    for (const operation of REQUIRED_OPERATIONS) {
        const metric = snapshot?.operations?.[operation];
        if (!metric) {
            errors.push(`missing operation ${operation}`);
            continue;
        }
        const liveSamples = Number(metric.sources?.live || 0);
        if (liveSamples < minimumLiveSamples) errors.push(`${operation} requires at least ${minimumLiveSamples} live samples; got ${liveSamples}`);
        for (const percentile of ['p50', 'p95', 'p99']) {
            const value = Number(metric.durationMs?.[percentile]);
            if (!Number.isFinite(value) || value < 0) errors.push(`${operation}.${percentile} must be a non-negative duration`);
        }
        if (!(Number(metric.durationMs?.p50) <= Number(metric.durationMs?.p95)
            && Number(metric.durationMs?.p95) <= Number(metric.durationMs?.p99))) {
            errors.push(`${operation} percentiles are not monotonic`);
        }
    }
    return Object.freeze({ contract: 'mcbot-live-workload-validation/v1', status: errors.length ? 'FAIL' : 'PASS', errors: Object.freeze(errors) });
}

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
}

function main() {
    const input = argument('--input');
    if (!input) throw new TypeError('Usage: node scripts/measure-live-workload.js --input <sanitized-runtime-metrics.json> [--minimum-live-samples 30]');
    const file = path.resolve(input);
    const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
    const report = validate(snapshot, { minimumLiveSamples: Number(argument('--minimum-live-samples') || 30) });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.status === 'PASS' ? 0 : 1;
    return report;
}

if (require.main === module) main();
module.exports = Object.freeze({ CONTRACT, REQUIRED_OPERATIONS, validate, main });
