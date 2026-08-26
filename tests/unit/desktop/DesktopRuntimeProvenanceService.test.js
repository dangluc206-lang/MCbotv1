'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const DesktopRuntimeProvenanceService = require('../../../src/desktop/readiness/DesktopRuntimeProvenanceService');

function write(root, relative, content) {
    const target = path.join(root, 'config', relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
}

test('DesktopRuntimeProvenanceService reports preserved runtime customizations without exposing content', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-runtime-provenance-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const templateRoot = path.join(root, 'application');
    const runtimeRoot = path.join(root, 'runtime-dev');
    write(templateRoot, 'server.json', '{"host":"default"}');
    write(templateRoot, 'bots/default.json', '{"enabled":false}');
    write(runtimeRoot, 'server.json', '{"host":"operator"}');
    write(runtimeRoot, 'bots/default.json', '{"enabled":false}');
    write(runtimeRoot, 'bots/operator.json', '{"enabled":true}');
    const service = new DesktopRuntimeProvenanceService({
        templateRoot,
        runtimeRoot,
        migrationReportProvider: () => ({ fromVersion: '2.7.66', toVersion: '2.7.67', filesMerged: 1, warnings: [] }),
        environmentProvenanceProvider: () => ({ dotenvState: 'LOADED', secretOverlay: 'OS_ENCRYPTED_STORE_LAST' })
    });

    const result = await service.sample();
    assert.equal(result.status, 'READY');
    assert.equal(result.parity, 'RUNTIME_CUSTOMIZED');
    assert.deepEqual(result.changes.changed.paths, ['server.json']);
    assert.deepEqual(result.changes.runtimeOnly.paths, ['bots/operator.json']);
    assert.deepEqual(result.connectionRelevant.paths, ['bots/operator.json', 'server.json']);
    assert.equal(result.changes.templateOnly.count, 0);
    assert.equal(result.migration.warningCount, 0);
    assert.equal(JSON.stringify(result).includes('operator\"'), false);
    assert.equal(result.sideEffects, 'NONE');
});

test('DesktopRuntimeProvenanceService blocks when migrated runtime is missing a template default', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-runtime-provenance-missing-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const templateRoot = path.join(root, 'application');
    const runtimeRoot = path.join(root, 'runtime-dev');
    write(templateRoot, 'server.json', '{}');
    fs.mkdirSync(path.join(runtimeRoot, 'config'), { recursive: true });
    const result = await new DesktopRuntimeProvenanceService({ templateRoot, runtimeRoot }).sample();
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.parity, 'RUNTIME_INCOMPLETE');
    assert.deepEqual(result.changes.templateOnly.paths, ['server.json']);
});

test('DesktopRuntimeProvenanceService returns a bounded error contract for missing config roots', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-runtime-provenance-error-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const result = await new DesktopRuntimeProvenanceService({
        templateRoot: path.join(root, 'missing-application'),
        runtimeRoot: path.join(root, 'missing-runtime')
    }).sample();
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.parity, 'UNKNOWN');
    assert.equal(Object.prototype.hasOwnProperty.call(result.error, 'message'), false);
});

test('DesktopRuntimeProvenanceService caches bounded scans and force refreshes explicitly', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-runtime-provenance-cache-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const templateRoot = path.join(root, 'application');
    const runtimeRoot = path.join(root, 'runtime-dev');
    write(templateRoot, 'server.json', '{}');
    write(runtimeRoot, 'server.json', '{}');
    let reads = 0;
    const fsPromises = require('node:fs/promises');
    const service = new DesktopRuntimeProvenanceService({
        templateRoot,
        runtimeRoot,
        cacheTtlMs: 5000,
        fsImpl: { ...fsPromises, async readFile(...args) { reads += 1; return fsPromises.readFile(...args); } }
    });
    const first = await service.sample();
    const cached = await service.sample();
    const forced = await service.sample({ force: true });
    assert.equal(cached, first);
    assert.notEqual(forced, first);
    assert.equal(reads, 4);
});

test('DesktopRuntimeProvenanceService rechecks byte budget after stat to close read races', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-runtime-provenance-race-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const templateRoot = path.join(root, 'application');
    const runtimeRoot = path.join(root, 'runtime-dev');
    write(templateRoot, 'server.json', '{}');
    write(runtimeRoot, 'server.json', '{}');
    const fsPromises = require('node:fs/promises');
    const runtimeFile = path.join(runtimeRoot, 'config', 'server.json');
    let expanded = false;
    const service = new DesktopRuntimeProvenanceService({
        templateRoot,
        runtimeRoot,
        fsImpl: {
            ...fsPromises,
            async stat(target) {
                const stat = await fsPromises.stat(target);
                if (!expanded && path.resolve(target) === path.resolve(runtimeFile)) {
                    expanded = true;
                    await fsPromises.writeFile(target, Buffer.alloc(DesktopRuntimeProvenanceService.LIMITS.MAX_FILE_BYTES + 1));
                }
                return stat;
            }
        }
    });
    const result = await service.sample();
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.error.code, 'DESKTOP_CONFIG_PROVENANCE_BYTE_LIMIT');
});
