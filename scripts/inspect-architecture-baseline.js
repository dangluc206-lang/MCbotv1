'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildBaseline, validateBaseline, renderGapReport } = require('./architecture-baseline');

const root = path.resolve(__dirname, '..');
const baselinePath = path.join(root, 'architecture/baseline/current.json');

function printFailures(result) {
    for (const failure of result.failures) {
        console.error(`[FAIL] ${failure.code} ${failure.file}: ${failure.message}`);
    }
}

function main() {
    if (process.argv.includes('--check')) {
        if (!fs.existsSync(baselinePath)) throw new Error('Baseline artifact is missing: architecture/baseline/current.json');
        const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
        const result = validateBaseline(baseline, { root, compareArchitecture: true });
        printFailures(result);
        console.log(`Architecture baseline validation completed with ${result.failures.length} failure(s).`);
        process.exitCode = result.valid ? 0 : 1;
        return;
    }

    if (process.argv.includes('--report')) {
        const baseline = fs.existsSync(baselinePath)
            ? JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
            : buildBaseline({ root });
        const result = validateBaseline(baseline, { root, compareArchitecture: true });
        if (!result.valid) {
            printFailures(result);
            process.exitCode = 1;
            return;
        }
        process.stdout.write(renderGapReport(baseline));
        return;
    }

    const baseline = buildBaseline({ root });
    const result = validateBaseline(baseline, { root, compareArchitecture: true });
    if (!result.valid) {
        printFailures(result);
        process.exitCode = 1;
        return;
    }
    process.stdout.write(`${JSON.stringify(baseline, null, 2)}\n`);
}

if (require.main === module) main();
