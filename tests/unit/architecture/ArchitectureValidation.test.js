'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const catalog = require('../../../architecture/catalog.json');
const { audit } = require('../../../scripts/validate-architecture');
const {
    normalizeRepositoryRelativePath,
    isDocumentPathAuthorized,
    validateGovernedDocumentRoots
} = require('../../../scripts/document-governance');

test('machine-readable architecture catalog matches the reachable project and exclusive owners', () => {
    const result = audit();
    assert.equal(result.valid, true, result.failures.map(failure => (
        `${failure.code} ${failure.file || ''}: ${failure.message}`
    )).join('\n'));
    assert.equal(result.catalog.sourceReachable, result.catalog.sourceFiles);
    assert.equal(result.catalog.configGroups, 32);
    assert.equal(result.catalog.connectionEvents, 31);
    assert.deepEqual(result.catalog.coverage, catalog.coverage);
    assert.equal(result.catalog.officialDocuments, catalog.officialDocuments.length);
    assert.equal(result.catalog.governedDocumentRoots, 1);
});

test('document governance authorizes only exact official files or exact governed roots', () => {
    assert.equal(normalizeRepositoryRelativePath('docs\\architecture-roadmap'), 'docs/architecture-roadmap');
    assert.equal(normalizeRepositoryRelativePath('../docs/architecture-roadmap'), null);
    assert.equal(normalizeRepositoryRelativePath('docs/../architecture-roadmap'), null);
    assert.equal(normalizeRepositoryRelativePath('C:\\repo\\docs'), null);

    const official = ['README.md'];
    const roots = ['docs/architecture-roadmap'];
    assert.equal(isDocumentPathAuthorized('README.md', official, roots), true);
    assert.equal(isDocumentPathAuthorized('docs/architecture-roadmap/README.md', official, roots), true);
    assert.equal(isDocumentPathAuthorized('docs/architecture-roadmap/phases/PHASE_0.md', official, roots), true);
    assert.equal(isDocumentPathAuthorized('docs/architecture-roadmap-other/README.md', official, roots), false);
    assert.equal(isDocumentPathAuthorized('docs/Architecture-Roadmap/README.md', official, roots), false);
    assert.equal(isDocumentPathAuthorized('docs/notes.md', official, roots), false);
});

test('governed document roots normalize Windows separators and fail closed for missing or traversing roots', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-doc-governance-'));
    try {
        fs.mkdirSync(path.join(tempRoot, 'docs', 'architecture-roadmap'), { recursive: true });

        const accepted = validateGovernedDocumentRoots(['docs\\architecture-roadmap'], tempRoot);
        assert.deepEqual(accepted.roots, ['docs/architecture-roadmap']);
        assert.deepEqual(accepted.failures, []);

        const missing = validateGovernedDocumentRoots(['docs/missing-roadmap'], tempRoot);
        assert.equal(missing.roots.length, 0);
        assert.equal(missing.failures[0]?.code, 'DOCUMENT_ROOT_MISSING');

        const traversal = validateGovernedDocumentRoots(['docs/../outside'], tempRoot);
        assert.equal(traversal.roots.length, 0);
        assert.equal(traversal.failures[0]?.code, 'DOCUMENT_ROOT_INVALID');
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});
