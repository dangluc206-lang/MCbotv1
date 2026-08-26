'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'architecture', 'coverage', 'critical-files.json'), 'utf8'));

function parseCoverage(output) {
    const plain = String(output || '').replace(/\u001b\[[0-9;]*m/g, '');
    const match = plain.match(/all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/i);
    return match ? { lines: Number(match[1]), branches: Number(match[2]), functions: Number(match[3]) } : null;
}

function runEntry(entry) {
    const args = ['--test', '--experimental-test-coverage', `--test-coverage-include=${entry.file}`, ...entry.tests];
    const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const observed = parseCoverage(output);
    const minimum = { ...contract.minimum, ...(entry.minimum || {}) };
    const failures = [];
    if (result.status !== 0) failures.push({ code: 'CRITICAL_COVERAGE_TEST_FAILED', exitCode: result.status, tail: output.slice(-2000) });
    if (!observed) failures.push({ code: 'CRITICAL_COVERAGE_REPORT_MISSING' });
    if (observed) {
        for (const metric of ['lines', 'branches', 'functions']) {
            if (observed[metric] < minimum[metric]) failures.push({ code: `CRITICAL_COVERAGE_${metric.toUpperCase()}`, observed: observed[metric], minimum: minimum[metric] });
        }
    }
    return Object.freeze({ file: entry.file, tests: entry.tests, observed, minimum, status: failures.length ? 'FAIL' : 'PASS', failures });
}

function check() {
    const files = contract.files.map(runEntry);
    return Object.freeze({ contract: contract.contract, status: files.every(file => file.status === 'PASS') ? 'PASS' : 'FAIL', files });
}

function main() {
    const report = check();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.status === 'PASS' ? 0 : 1;
    return report;
}

if (require.main === module) main();
module.exports = Object.freeze({ check, main, parseCoverage, runEntry });
