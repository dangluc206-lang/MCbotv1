'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relative) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8'));
}

function check() {
    const policy = read('architecture/version-policy.json');
    const pkg = read('package.json');
    const lock = read('package-lock.json');
    const catalog = read('architecture/catalog.json');
    const baseline = read('architecture/baseline/current.json');
    const failures = [];
    if (policy.contract !== 'mcbot-version-authority/v1') failures.push('version policy contract is invalid');
    if (policy.productVersion?.source !== 'package.json#/version') failures.push('product version authority must be package.json#/version');
    if (policy.architectureSchemaVersion?.source !== 'architecture/catalog.json#/schemaVersion') failures.push('architecture schema authority is invalid');
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version || '')) failures.push('package product version is not semver');
    if (pkg.productVersion !== undefined || pkg.architectureVersion !== undefined) failures.push('package.json must not duplicate product or architecture version aliases');
    if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) failures.push('package-lock product version differs from package.json');
    if (!Number.isInteger(catalog.schemaVersion) || catalog.schemaVersion <= 0) failures.push('architecture catalog schemaVersion must be a positive integer');
    if (catalog.version !== undefined) failures.push('architecture catalog must use schemaVersion, not ambiguous version');
    if (baseline.releaseVersion !== pkg.version) failures.push('architecture baseline releaseVersion differs from package product version');
    return Object.freeze({
        contract: policy.contract,
        status: failures.length ? 'FAIL' : 'PASS',
        productVersion: pkg.version,
        architectureSchemaVersion: catalog.schemaVersion,
        failures: Object.freeze(failures)
    });
}

function main() {
    const report = check();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.status === 'PASS' ? 0 : 1;
    return report;
}

if (require.main === module) main();
module.exports = Object.freeze({ check, main });
