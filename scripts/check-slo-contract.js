'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Metric = require('../src/diagnostics/metrics/SloMetricContract');

function fail(message) {
    process.stderr.write(`[FAIL] slo-contract: ${message}\n`);
    process.exitCode = 1;
}

const root = path.resolve(__dirname, '..');
const artifact = JSON.parse(fs.readFileSync(path.join(root, 'architecture', 'slo', 'current.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (artifact.generatedForVersion !== packageJson.version) fail(`version ${artifact.generatedForVersion} != package ${packageJson.version}`);
if (artifact.defaultScope !== 'LOCAL_ONLY') fail('default scope must remain LOCAL_ONLY');
for (const objective of artifact.objectives || []) {
    if (!Metric.METRICS[objective.metric]) fail(`unknown metric ${objective.metric}`);
    if (!['MEASURABLE_LOCALLY', 'NOT_MEASURABLE_YET'].includes(objective.measurement)) fail(`invalid measurement state for ${objective.id}`);
    if (objective.measurement === 'NOT_MEASURABLE_YET' && !objective.reason) fail(`missing reason for ${objective.id}`);
}
for (const [name, definition] of Object.entries(Metric.METRICS)) {
    for (const dimension of definition.dimensions) if (Metric.FORBIDDEN_DIMENSIONS.test(dimension)) fail(`forbidden dimension ${name}.${dimension}`);
}
if (!process.exitCode) process.stdout.write(`[PASS] local SLO/privacy contract v1 (${artifact.objectives.length} objectives)\n`);
