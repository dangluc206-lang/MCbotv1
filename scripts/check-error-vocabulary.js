'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Contract = require('../src/shared/contracts/OperatorErrorContract');

function fail(message) {
    process.stderr.write(`[FAIL] error-vocabulary: ${message}\n`);
    process.exitCode = 1;
}

const root = path.resolve(__dirname, '..');
const artifact = JSON.parse(fs.readFileSync(path.join(root, 'architecture', 'error-vocabulary', 'current.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (artifact.generatedForVersion !== packageJson.version) fail(`version ${artifact.generatedForVersion} != package ${packageJson.version}`);
if (JSON.stringify(artifact.categories) !== JSON.stringify(Contract.CATEGORIES)) fail('category catalog differs from runtime contract');
if (JSON.stringify(artifact.severities) !== JSON.stringify(Contract.SEVERITIES)) fail('severity catalog differs from runtime contract');
if (JSON.stringify(artifact.retryClasses) !== JSON.stringify(Contract.RETRY_CLASSES)) fail('retry catalog differs from runtime contract');
for (const [id, definition] of Object.entries(artifact.allowedActions || {})) {
    if (!Contract.ACTION_CATALOG[id]) fail(`unknown action ${id}`);
    if (!['READ', 'PATCH', 'DEVELOP', 'ADMIN'].includes(definition.permission)) fail(`invalid permission for ${id}`);
    if (/^\//.test(id) || /chat|callback|javascript/i.test(id)) fail(`unsafe action id ${id}`);
}
if (!process.exitCode) process.stdout.write(`[PASS] canonical error vocabulary v1 (${Object.keys(artifact.allowedActions).length} actions)\n`);
