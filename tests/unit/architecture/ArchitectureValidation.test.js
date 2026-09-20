'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const catalog = require('../../../architecture/catalog.json');
const {
    audit,
    validatePendingWiringSources
} = require('../../../scripts/validate-architecture');
const {
    normalizeRepositoryRelativePath,
    isDocumentPathAuthorized,
    isDocumentScanExcluded,
    validateGovernedDocumentRoots,
    validateDocumentScanExclusions
} = require('../../../scripts/document-governance');

const root = path.resolve(__dirname, '../../..');

test('machine-readable architecture catalog matches the reachable project and exclusive owners', () => {
    const result = audit();
    assert.equal(result.valid, true, result.failures.map(failure => (
        `${failure.code} ${failure.file || ''}: ${failure.message}`
    )).join('\n'));
    assert.equal(result.catalog.sourceReachable + result.catalog.pendingWiringSources, result.catalog.sourceFiles);
    assert.equal(result.catalog.pendingWiringSources, catalog.pendingWiringSources.length);
    assert.equal(result.catalog.configGroups, 33);
    assert.equal(result.catalog.connectionEvents, 31);
    assert.deepEqual(result.catalog.coverage, catalog.coverage);
    assert.equal(result.catalog.officialDocuments, catalog.officialDocuments.length);
    assert.equal(result.catalog.documentScanExclusions, catalog.documentScanExclusions.length);
});

test('every unreachable source file is either reported as an orphan or declared as pending wiring', () => {
    const result = audit();
    assert.equal(result.failures.filter(failure => failure.code === 'SOURCE_ORPHAN').length, 0);
    const declared = catalog.pendingWiringSources.map(entry => entry.file).sort();
    assert.ok(declared.length > 0, 'pending wiring declarations are required while unwired modules exist');
    assert.ok(catalog.pendingWiringSources.every(entry => entry.owner?.trim() && entry.reason?.trim()), 'every declaration needs owner and reason evidence');
    const warned = result.warnings
        .filter(warning => warning.code === 'SOURCE_PENDING_WIRING')
        .map(warning => warning.file)
        .sort();
    assert.deepEqual(warned, declared, 'declarations must match the current unreachable set exactly');
});

test('document governance authorizes only exact official files or exact governed roots', () => {
    assert.equal(normalizeRepositoryRelativePath('architecture\\catalog.json'), 'architecture/catalog.json');
    assert.equal(normalizeRepositoryRelativePath('../architecture/catalog.json'), null);
    assert.equal(normalizeRepositoryRelativePath('architecture/../catalog.json'), null);
    assert.equal(normalizeRepositoryRelativePath('C:\\repo\\architecture'), null);

    const official = ['.clinerules/00-core.md'];
    const roots = ['.clinerules'];
    assert.equal(isDocumentPathAuthorized('.clinerules/00-core.md', official, roots), true);
    assert.equal(isDocumentPathAuthorized('.clinerules/01-verification.md', official, roots), true);
    assert.equal(isDocumentPathAuthorized('.clinerules-other/00-core.md', official, roots), false);
    assert.equal(isDocumentPathAuthorized('.CLINERULES/00-core.md', official, roots), false);
    assert.equal(isDocumentPathAuthorized('architecture/catalog.json', official, roots), false);
});

test('document scan exclusions fail closed and match only the excluded tree', () => {
    assert.equal(isDocumentScanExcluded('.clinerules/00-core.md', ['.clinerules']), true);
    assert.equal(isDocumentScanExcluded('.clinerules', ['.clinerules']), true);
    assert.equal(isDocumentScanExcluded('.clinerules-other/00-core.md', ['.clinerules']), false);
    assert.equal(isDocumentScanExcluded('architecture/catalog.json', ['.clinerules']), false);

    assert.deepEqual(validateDocumentScanExclusions(['.cline', '.clinerules'], root).exclusions, ['.cline', '.clinerules']);
    assert.deepEqual(validateDocumentScanExclusions(undefined, root), { failures: [], exclusions: [] });
    assert.equal(validateDocumentScanExclusions('not-an-array', root).failures[0]?.code, 'DOCUMENT_SCAN_EXCLUSIONS_INVALID');
    assert.equal(validateDocumentScanExclusions(['.cline', '.cline'], root).failures[0]?.code, 'DOCUMENT_SCAN_EXCLUSION_DUPLICATE');
    assert.equal(validateDocumentScanExclusions(['../outside'], root).failures[0]?.code, 'DOCUMENT_SCAN_EXCLUSION_INVALID');
    assert.equal(validateDocumentScanExclusions(['C:\\repo\\.cline'], root).failures[0]?.code, 'DOCUMENT_SCAN_EXCLUSION_INVALID');
});

test('pending wiring declarations fail closed for missing, duplicate, unreachable-free or evidence-free entries', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-pending-wiring-'));
    try {
        fs.mkdirSync(path.join(tempRoot, 'src'), { recursive: true });
        const source = path.join(tempRoot, 'src', 'unwired.js');
        fs.writeFileSync(source, "'use strict';\nmodule.exports = {};\n", 'utf8');
        const sourceFiles = [source];
        const unreachable = new Set();

        const declared = validatePendingWiringSources(
            [{ file: 'src/unwired.js', owner: 'crafting', reason: 'awaits wiring' }],
            tempRoot,
            sourceFiles,
            unreachable
        );
        assert.deepEqual(declared.failures, []);
        assert.equal(declared.files.size, 1);

        const reachable = validatePendingWiringSources(
            [{ file: 'src/unwired.js', owner: 'crafting', reason: 'awaits wiring' }],
            tempRoot,
            sourceFiles,
            new Set([source])
        );
        assert.equal(reachable.failures[0]?.code, 'PENDING_WIRING_SOURCE_REACHABLE');

        const missing = validatePendingWiringSources(
            [{ file: 'src/gone.js', owner: 'crafting', reason: 'awaits wiring' }],
            tempRoot,
            sourceFiles,
            unreachable
        );
        assert.equal(missing.failures[0]?.code, 'PENDING_WIRING_SOURCE_MISSING');

        const duplicate = validatePendingWiringSources(
            [
                { file: 'src/unwired.js', owner: 'crafting', reason: 'awaits wiring' },
                { file: 'src/unwired.js', owner: 'crafting', reason: 'awaits wiring' }
            ],
            tempRoot,
            sourceFiles,
            unreachable
        );
        assert.equal(duplicate.failures[0]?.code, 'PENDING_WIRING_DUPLICATE');

        const evidenceFree = validatePendingWiringSources(
            [{ file: 'src/unwired.js', owner: 'crafting' }],
            tempRoot,
            sourceFiles,
            unreachable
        );
        assert.equal(evidenceFree.failures[0]?.code, 'PENDING_WIRING_EVIDENCE_MISSING');

        const invalid = validatePendingWiringSources(['src/unwired.js'], tempRoot, sourceFiles, unreachable);
        assert.equal(invalid.failures[0]?.code, 'PENDING_WIRING_ENTRY_INVALID');
        assert.equal(validatePendingWiringSources('nope', tempRoot, sourceFiles, unreachable).failures[0]?.code, 'PENDING_WIRING_INVALID');
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('governed document roots normalize Windows separators and fail closed for missing or traversing roots', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-doc-governance-'));
    try {
        fs.mkdirSync(path.join(tempRoot, '.clinerules'), { recursive: true });

        const accepted = validateGovernedDocumentRoots(['.clinerules'], tempRoot);
        assert.deepEqual(accepted.roots, ['.clinerules']);
        assert.deepEqual(accepted.failures, []);

        const windowsSeparators = validateGovernedDocumentRoots(['.clinerules\\nested'], tempRoot);
        assert.equal(windowsSeparators.failures[0]?.code, 'DOCUMENT_ROOT_MISSING');

        const missing = validateGovernedDocumentRoots(['architecture/missing-roadmap'], tempRoot);
        assert.equal(missing.roots.length, 0);
        assert.equal(missing.failures[0]?.code, 'DOCUMENT_ROOT_MISSING');

        const traversal = validateGovernedDocumentRoots(['architecture/../outside'], tempRoot);
        assert.equal(traversal.roots.length, 0);
        assert.equal(traversal.failures[0]?.code, 'DOCUMENT_ROOT_INVALID');
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});
