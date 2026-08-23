'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { audit } = require('../../../scripts/validate-architecture');
const {
    isExcludedPath,
    walkFiles,
    buildBaseline,
    validateBaseline
} = require('../../../scripts/architecture-baseline');

const root = path.resolve(__dirname, '../../..');

test('WP-001 baseline path policy excludes secrets, runtime payloads, dependencies, and logs', () => {
    for (const value of ['.env', '.env.local', 'data/runtime/gui/x.json', 'data\\runtime\\gui\\x.json', 'node_modules/pkg/index.js', 'logs/runtime.log']) {
        assert.equal(isExcludedPath(value), true, value);
    }
    assert.equal(isExcludedPath('config/bots/bot-01.json'), false, 'bot profile path is inventory-visible');
    assert.equal(isExcludedPath('config/bots/bot-01.json', { contentScan: true }), true, 'bot profile payload is not content-scanned');
    assert.equal(isExcludedPath('src/index.js'), false);
    assert.equal(walkFiles(root).some(file => isExcludedPath(file)), false);
});

test('WP-001 generated baseline validates and matches architecture inspection counts', () => {
    const baseline = buildBaseline({ root, generatedAt: '2026-08-22T00:00:00.000Z' });
    const result = validateBaseline(baseline, { root, compareArchitecture: true });
    assert.deepEqual(result.failures, []);
    assert.equal(result.valid, true);
    const current = audit();
    assert.equal(baseline.architectureInspection.catalog.sourceFiles, current.catalog.sourceFiles);
    assert.equal(baseline.architectureInspection.catalog.runtimeReachable, current.catalog.runtimeReachable);
    assert.equal(baseline.architectureInspection.catalog.configGroups, current.catalog.configGroups);
    assert.equal(baseline.architectureInspection.catalog.connectionEvents, current.catalog.connectionEvents);
    assert.match(baseline.revision.sourceFingerprintSha256, /^[a-f0-9]{64}$/);
    assert.ok(baseline.capabilities.ids.includes('storage'));
    assert.ok(baseline.capabilities.ids.includes('crafting'));
    assert.ok(baseline.capabilities.ids.includes('skyblock'));
    assert.ok(baseline.sourceAreas.every(area => area.classification === 'CURRENT' && area.layer !== 'UNCLASSIFIED' && typeof area.owner === 'string' && area.owner.length > 0));
    assert.equal(baseline.dynamicConfiguration.find(item => item.id === 'bot-profiles')?.contentCaptured, false);
});

test('WP-001 schema contract rejects missing required top-level fields', () => {
    const baseline = buildBaseline({ root, generatedAt: '2026-08-22T00:00:00.000Z' });
    delete baseline.events;
    const result = validateBaseline(baseline, { root, compareArchitecture: false });
    assert.equal(result.valid, false);
    assert.ok(result.failures.some(failure => failure.code === 'BASELINE_SCHEMA_REQUIRED' && /events/.test(failure.message)));
});

test('WP-001 committed baseline artifact is schema-valid, safe, and bounded', () => {
    const file = path.join(root, 'architecture/baseline/current.json');
    assert.equal(fs.existsSync(file), true);
    const baseline = JSON.parse(fs.readFileSync(file, 'utf8'));
    const result = validateBaseline(baseline, { root, compareArchitecture: true });
    assert.deepEqual(result.failures, []);
    assert.equal(baseline.workPackage, 'WP-001');
    assert.ok(baseline.sourceAreas.length >= 10);
    assert.ok(baseline.configuration.length >= 20);
    assert.ok(baseline.events.connectionScoped.length >= 20);
    assert.ok(baseline.findings.every(item => ['CURRENT', 'TARGET', 'DEBT', 'UNKNOWN'].includes(item.category)));
});


test('post-roadmap baseline findings cannot regress to historical P0/P1 pending labels', () => {
    const baseline = buildBaseline({ root, generatedAt: '2026-08-22T00:00:00.000Z' });
    const byCode = new Map(baseline.findings.map(item => [item.code, item]));
    for (const stale of [
        'COMMON_CONTRACT_ADR_PENDING',
        'SERVER_FACTS_DISTRIBUTED',
        'CONFIG_TRANSACTION_CLOSURE_PENDING',
        'SIDE_EFFECT_OWNERSHIP_AUDIT_PENDING',
        'GENERATION_CANCELLATION_AUDIT_PENDING'
    ]) assert.equal(byCode.has(stale), false, stale);
    for (const current of [
        'COMMON_CONTRACTS_ACTIVE',
        'SERVER_PROFILE_BOUNDARY_ACTIVE',
        'CONFIG_TRANSACTION_CLOSED',
        'SIDE_EFFECT_OWNERSHIP_CLOSED',
        'GENERATION_CANCELLATION_GUARDS_ACTIVE',
        'RELEASE_ZIP_CONTRACT_ACTIVE'
    ]) assert.equal(byCode.get(current)?.category, 'CURRENT', current);
    const legacy = byCode.get('MODE_LIFECYCLE_STRANGLER_DEBT');
    assert.equal(legacy?.category, 'DEBT');
    assert.match(legacy?.summary || '', /strangler-adapter/i);
    assert.deepEqual(legacy?.workPackages, ['WP-201', 'WP-203']);
});


test('baseline semantic validator rejects a committed historical pending finding even when counts still match', () => {
    const baseline = buildBaseline({ root, generatedAt: '2026-08-22T00:00:00.000Z' });
    baseline.findings[1] = {
        code: 'COMMON_CONTRACT_ADR_PENDING',
        category: 'TARGET',
        file: 'docs/architecture-roadmap/work-packages/WP-002_COMMON_CONTRACTS_ADR.md',
        summary: 'stale historical finding',
        workPackages: ['WP-002']
    };
    const result = validateBaseline(baseline, { root, compareArchitecture: true });
    assert.equal(result.valid, false);
    assert.ok(result.failures.some(failure => failure.code === 'BASELINE_FINDINGS_STALE'));
});
