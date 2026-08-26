'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONTRACT = path.join('architecture', 'package-footprint', 'current.json');

function loadPackagingFootprintContract(baseDir, contractPath = DEFAULT_CONTRACT) {
    const absolutePath = path.resolve(baseDir, contractPath);
    const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    validatePackagingFootprintContract(parsed);
    return Object.freeze({
        ...parsed,
        baseline: Object.freeze({ ...parsed.baseline }),
        limits: Object.freeze({ ...parsed.limits }),
        policy: Object.freeze({ ...parsed.policy }),
        absolutePath
    });
}

function validatePackagingFootprintContract(contract) {
    if (!contract || contract.contractVersion !== 1) {
        throw new Error('Packaging footprint contractVersion must be 1.');
    }
    const limits = contract.limits || {};
    for (const key of ['maximumMegabytes', 'minimumFiles', 'minimumMegabytes', 'minimumIgnoredDirectories']) {
        if (!Number.isFinite(limits[key]) || limits[key] < 0) {
            throw new Error(`Packaging footprint limits.${key} must be a non-negative number.`);
        }
    }
    const measured = Number(contract.baseline?.measuredMegabytes);
    if (!Number.isFinite(measured) || measured <= 0 || measured > limits.maximumMegabytes) {
        throw new Error('Packaging footprint baseline must be positive and within maximumMegabytes.');
    }
    if (contract.policy?.environmentMayLowerMaximumOnly !== true) {
        throw new Error('Packaging footprint policy must keep environment overrides fail-closed.');
    }
    return contract;
}

function effectiveMaximumMegabytes(contract, requestedMaximum) {
    const hardMaximum = contract.limits.maximumMegabytes;
    const requested = Number(requestedMaximum);
    if (!Number.isFinite(requested) || requested <= 0) return hardMaximum;
    return Math.min(hardMaximum, requested);
}

function evaluatePackagingFootprint(stats, contract, { requestedMaximum } = {}) {
    const maximumMegabytes = effectiveMaximumMegabytes(contract, requestedMaximum);
    const limits = contract.limits;
    const failures = [];
    if (!stats || !Number.isFinite(stats.files) || !Number.isFinite(stats.megabytes)) {
        failures.push('measurement-invalid');
    } else {
        if (stats.files < limits.minimumFiles) failures.push('payload-files-below-minimum');
        if (stats.megabytes < limits.minimumMegabytes) failures.push('payload-size-below-minimum');
        if (stats.megabytes > maximumMegabytes) failures.push('payload-size-above-maximum');
        if (stats.ignoredDirectories < limits.minimumIgnoredDirectories) failures.push('ignore-policy-not-applied');
    }
    return Object.freeze({
        valid: failures.length === 0,
        failures: Object.freeze(failures),
        maximumMegabytes,
        baselineMegabytes: contract.baseline.measuredMegabytes,
        contractVersion: contract.contractVersion
    });
}

module.exports = {
    DEFAULT_CONTRACT,
    effectiveMaximumMegabytes,
    evaluatePackagingFootprint,
    loadPackagingFootprintContract,
    validatePackagingFootprintContract
};
