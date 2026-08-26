'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SupportBundleBuilder = require('../src/diagnostics/support/SupportBundleBuilder');

const file = process.argv[2];
if (file === '--self-check') {
    const bundle = new SupportBundleBuilder().build({
        createdAt: '2026-08-25T00:00:00.000Z',
        pseudonymSalt: 'support-validator-self-check',
        entries: [{ path: 'evidence/health-validator.json', value: { status: 'OK', botId: 'self-check-bot' } }]
    });
    const result = SupportBundleBuilder.validate(bundle);
    if (!result.valid) {
        process.stderr.write(`[FAIL] support bundle self-check: ${result.errors.join(', ')}\n`);
        process.exitCode = 1;
    } else {
        process.stdout.write(`[PASS] support bundle validator self-check v${bundle.version}\n`);
    }
} else if (!file) {
    process.stderr.write('Usage: node scripts/validate-support-bundle.js <bundle.json>\n');
    process.exitCode = 2;
} else {
    try {
        const target = path.resolve(process.cwd(), file);
        const bundle = JSON.parse(fs.readFileSync(target, 'utf8'));
        const result = SupportBundleBuilder.validate(bundle);
        if (!result.valid) {
            process.stderr.write(`[FAIL] support bundle: ${result.errors.join(', ')}\n`);
            process.exitCode = 1;
        } else {
            process.stdout.write(`[PASS] support bundle v${bundle.version}, ${bundle.entryCount} entries, ${bundle.totalBytes} bytes\n`);
        }
    } catch (error) {
        process.stderr.write(`[FAIL] support bundle: ${error.message}\n`);
        process.exitCode = 1;
    }
}
