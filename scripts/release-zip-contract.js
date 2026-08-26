'use strict';

const path = require('node:path');

const CONTRACT = 'release-zip-contract';
const VERSION = 1;

const REQUIRED_FILES = Object.freeze([
    '.env.example',
    'AGENTS.md',
    'ARCHITECTURE.md',
    'JS_RESPONSIBILITIES.md',
    'README.md',
    'RELEASE_NOTES.txt',
    'RULES.md',
    'SERVER_BEHAVIOR.md',
    'START_HERE.txt',
    'architecture/baseline/current.json',
    'architecture/catalog.json',
    'docs/architecture-roadmap/15_WORK_PACKAGE_INDEX.md',
    'forge.config.js',
    'package-lock.json',
    'package.json',
    'scripts/build/DirectWindowsPackager.js',
    'scripts/build/ForgePackagingPolicy.js',
    'scripts/build/make-windows-installer.js',
    'scripts/build/package-windows-direct.js',
    'src/index.js'
]);

const FORBIDDEN_SEGMENTS = new Set(['.git', '.tmp', 'coverage', 'data', 'node_modules', 'out']);
const FORBIDDEN_PREFIXES = Object.freeze([
    'data/logs/',
    'data/runtime/',
    'data/snapshots/',
    'data/backups/',
    'data/support/',
    'config/modes/custom/'
]);

function normalizeEntryName(name) {
    if (typeof name !== 'string' || !name.length) throw new TypeError('ZIP entry name must be a non-empty string.');
    if (name.includes('\0')) throw new Error('ZIP entry contains NUL.');
    const slash = name.replace(/\\/g, '/');
    const directory = slash.endsWith('/');
    const raw = directory ? slash.slice(0, -1) : slash;
    if (!raw || raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) throw new Error(`ZIP entry is absolute: ${name}`);
    if (raw.includes('//')) throw new Error(`ZIP entry contains an empty path segment: ${name}`);
    const parts = raw.split('/');
    if (parts.some(part => part === '.' || part === '..' || part === '')) throw new Error(`ZIP entry contains traversal/ambiguous segment: ${name}`);
    const normalized = path.posix.normalize(raw);
    if (normalized !== raw || normalized.startsWith('../')) throw new Error(`ZIP entry is not canonical: ${name}`);
    return { name: normalized, directory };
}

function forbiddenReason(file) {
    const normalized = String(file || '').replace(/\\/g, '/').toLowerCase();
    const parts = normalized.split('/');
    if (parts.some(part => FORBIDDEN_SEGMENTS.has(part))) return 'forbidden-directory';
    const base = parts.at(-1);
    if (base === '.env' || (base.startsWith('.env.') && base !== '.env.example')) return 'secret-env-file';
    if (base === 'secrets.json') return 'secret-store-file';
    if (base.endsWith('.log')) return 'runtime-log-file';
    if (FORBIDDEN_PREFIXES.some(prefix => normalized.startsWith(prefix))) return 'runtime-or-user-data';
    return null;
}

function validateEntryNames(entryNames, { requiredFiles = REQUIRED_FILES } = {}) {
    if (!Array.isArray(entryNames)) throw new TypeError('entryNames must be an array.');
    const failures = [];
    const files = new Set();
    const seenCanonical = new Map();

    for (const entryName of entryNames) {
        let entry;
        try {
            entry = normalizeEntryName(entryName);
        } catch (error) {
            failures.push({ code: 'ZIP_ENTRY_UNSAFE', entry: String(entryName), message: error.message });
            continue;
        }
        const canonical = entry.name.toLowerCase();
        const previous = seenCanonical.get(canonical);
        if (previous && previous !== entry.name) {
            failures.push({ code: 'ZIP_CASE_COLLISION', entry: entry.name, message: `Conflicts with ${previous}` });
        } else if (previous) {
            failures.push({ code: 'ZIP_DUPLICATE_ENTRY', entry: entry.name, message: 'Duplicate central-directory entry.' });
        } else {
            seenCanonical.set(canonical, entry.name);
        }
        if (entry.directory) continue;
        files.add(entry.name);
        const reason = forbiddenReason(entry.name);
        if (reason) failures.push({ code: 'ZIP_FORBIDDEN_FILE', entry: entry.name, message: reason });
    }

    for (const required of requiredFiles) {
        if (!files.has(required)) failures.push({ code: 'ZIP_REQUIRED_FILE_MISSING', entry: required, message: 'Required release file is missing.' });
    }

    return Object.freeze({
        contract: CONTRACT,
        version: VERSION,
        valid: failures.length === 0,
        fileCount: files.size,
        failures: Object.freeze(failures.map(item => Object.freeze({ ...item })))
    });
}

module.exports = Object.freeze({
    CONTRACT,
    VERSION,
    REQUIRED_FILES,
    FORBIDDEN_SEGMENTS,
    FORBIDDEN_PREFIXES,
    normalizeEntryName,
    forbiddenReason,
    validateEntryNames
});
