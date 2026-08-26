'use strict';

const ReleaseCanaryPolicy = require('../src/desktop/update/ReleaseCanaryPolicy');

function check() {
    const policy = new ReleaseCanaryPolicy({ minObservationMs: 1000, maxFailureRate: 0.02 });
    const base = { stagePercent:5, observedMs:1000, attempts:100, failures:0, criticalIncidents:0, integrityValid:true, rollbackReady:true };
    const decisions = Object.freeze({
        invalid:policy.decide({ ...base, stagePercent:7 }),
        unsafe:policy.decide({ ...base, integrityValid:false }),
        hold:policy.decide({ ...base, observedMs:999 }),
        rollback:policy.decide({ ...base, failures:3 }),
        advance:policy.decide(base),
        complete:policy.decide({ ...base, stagePercent:100 })
    });
    const expected = { invalid:'BLOCK', unsafe:'BLOCK', hold:'HOLD', rollback:'ROLLBACK', advance:'ADVANCE', complete:'COMPLETE' };
    const failures = Object.entries(expected)
        .filter(([key, action]) => decisions[key]?.action !== action)
        .map(([key, action]) => ({ scenario:key, expected:action, observed:decisions[key]?.action || null }));
    return Object.freeze({ contract:'release-canary-policy-check/v1', status:failures.length ? 'FAIL' : 'PASS', failures, decisions });
}

function main() {
    const report = check();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.status === 'PASS' ? 0 : 1;
    return report;
}

if (require.main === module) main();
module.exports = Object.freeze({ check, main });
