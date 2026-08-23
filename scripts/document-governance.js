'use strict';

const fs = require('node:fs');
const path = require('node:path');

function normalizeRepositoryRelativePath(value) {
    if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) return null;
    const normalized = value.replace(/\\/g, '/');
    if (normalized.startsWith('/') || normalized.startsWith('//') || /^[A-Za-z]:\//.test(normalized)) return null;
    const segments = normalized.split('/');
    if (segments.some(segment => !segment || segment === '.' || segment === '..')) return null;
    return segments.join('/');
}

function isInsidePath(parent, child) {
    const candidate = path.relative(parent, child);
    return candidate === '' || (candidate !== '..' && !candidate.startsWith(`..${path.sep}`) && !path.isAbsolute(candidate));
}

function exactCasePathExists(repoRoot, repositoryRelativePath) {
    let current = repoRoot;
    for (const segment of repositoryRelativePath.split('/')) {
        if (!fs.existsSync(current) || !fs.statSync(current).isDirectory()) return false;
        const names = fs.readdirSync(current);
        if (!names.includes(segment)) return false;
        current = path.join(current, segment);
    }
    return true;
}

function collectSymlinks(directory, repoRoot, result = []) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
            result.push(path.relative(repoRoot, full).split(path.sep).join('/'));
            continue;
        }
        if (entry.isDirectory()) collectSymlinks(full, repoRoot, result);
    }
    return result;
}

function validateGovernedDocumentRoots(configuredRoots, repoRoot) {
    const failures = [];
    const roots = [];
    if (configuredRoots === undefined) return { failures, roots };
    if (!Array.isArray(configuredRoots)) {
        failures.push({
            code: 'DOCUMENT_ROOTS_INVALID',
            message: 'governedDocumentRoots must be an array of repository-relative directory paths.',
            file: 'architecture/catalog.json'
        });
        return { failures, roots };
    }

    const seen = new Set();
    const realRepoRoot = fs.realpathSync(repoRoot);
    for (const configuredRoot of configuredRoots) {
        const normalized = normalizeRepositoryRelativePath(configuredRoot);
        if (!normalized) {
            failures.push({
                code: 'DOCUMENT_ROOT_INVALID',
                message: `Invalid governed document root: ${String(configuredRoot)}`,
                file: 'architecture/catalog.json'
            });
            continue;
        }
        if (seen.has(normalized)) {
            failures.push({
                code: 'DOCUMENT_ROOT_DUPLICATE',
                message: `Duplicate governed document root: ${normalized}`,
                file: 'architecture/catalog.json'
            });
            continue;
        }
        seen.add(normalized);

        const full = path.resolve(repoRoot, normalized);
        if (!isInsidePath(repoRoot, full)) {
            failures.push({
                code: 'DOCUMENT_ROOT_ESCAPE',
                message: `Governed document root escapes repository: ${normalized}`,
                file: normalized
            });
            continue;
        }
        if (!fs.existsSync(full)) {
            failures.push({
                code: 'DOCUMENT_ROOT_MISSING',
                message: `Governed document root is missing: ${normalized}`,
                file: normalized
            });
            continue;
        }
        if (!exactCasePathExists(repoRoot, normalized)) {
            failures.push({
                code: 'DOCUMENT_ROOT_CASE_MISMATCH',
                message: `Governed document root casing does not match disk: ${normalized}`,
                file: normalized
            });
            continue;
        }

        let cursor = repoRoot;
        let symlinkSegment = null;
        for (const segment of normalized.split('/')) {
            cursor = path.join(cursor, segment);
            if (fs.lstatSync(cursor).isSymbolicLink()) {
                symlinkSegment = path.relative(repoRoot, cursor).split(path.sep).join('/');
                break;
            }
        }
        if (symlinkSegment) {
            failures.push({
                code: 'DOCUMENT_ROOT_SYMLINK',
                message: `Governed document root contains a symlink path segment: ${symlinkSegment}`,
                file: symlinkSegment
            });
            continue;
        }
        if (!fs.statSync(full).isDirectory()) {
            failures.push({
                code: 'DOCUMENT_ROOT_NOT_DIRECTORY',
                message: `Governed document root is not a directory: ${normalized}`,
                file: normalized
            });
            continue;
        }

        const realRoot = fs.realpathSync(full);
        if (!isInsidePath(realRepoRoot, realRoot)) {
            failures.push({
                code: 'DOCUMENT_ROOT_ESCAPE',
                message: `Governed document root resolves outside repository: ${normalized}`,
                file: normalized
            });
            continue;
        }

        const symlinks = collectSymlinks(full, repoRoot);
        if (symlinks.length > 0) {
            for (const symlink of symlinks) {
                failures.push({
                    code: 'DOCUMENT_ROOT_SYMLINK',
                    message: `Symlink is not allowed inside governed document roots: ${symlink}`,
                    file: symlink
                });
            }
            continue;
        }

        roots.push(normalized);
    }
    return { failures, roots };
}

function isDocumentPathAuthorized(file, officialDocuments = [], governedRoots = []) {
    const normalized = normalizeRepositoryRelativePath(file);
    if (!normalized) return false;
    const official = new Set(officialDocuments.map(normalizeRepositoryRelativePath).filter(Boolean));
    if (official.has(normalized)) return true;
    return governedRoots.some(governedRoot => normalized.startsWith(`${governedRoot}/`));
}

module.exports = Object.freeze({
    normalizeRepositoryRelativePath,
    isDocumentPathAuthorized,
    validateGovernedDocumentRoots
});
