'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const CONTRACT = 'desktop-runtime-provenance-v1';
const MAX_FILES = 4096;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_REPORTED_PATHS = 100;
const DEFAULT_CACHE_TTL_MS = 5000;

function safeVersion(value) {
    if (value === null || value === undefined) return null;
    return String(value).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64) || null;
}

function safeCount(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(number))) : 0;
}

function safeMigrationSummary(report) {
    if (!report || typeof report !== 'object') return null;
    return Object.freeze({
        fromVersion: safeVersion(report.fromVersion),
        toVersion: safeVersion(report.toVersion),
        filesAdded: safeCount(report.filesAdded),
        filesMerged: safeCount(report.filesMerged),
        filesUnchanged: safeCount(report.filesUnchanged),
        migratedFileCount: Array.isArray(report.migratedFiles) ? report.migratedFiles.length : 0,
        warningCount: Array.isArray(report.warnings) ? report.warnings.length : 0
    });
}

function boundedPaths(values) {
    const sorted = [...values].sort();
    return Object.freeze({
        paths: Object.freeze(sorted.slice(0, MAX_REPORTED_PATHS)),
        count: sorted.length,
        truncated: sorted.length > MAX_REPORTED_PATHS
    });
}

class DesktopRuntimeProvenanceService {
    constructor({
        templateRoot,
        runtimeRoot,
        isPackaged = false,
        migrationReportProvider = () => null,
        environmentProvenanceProvider = () => null,
        cacheTtlMs = DEFAULT_CACHE_TTL_MS,
        clock = () => Date.now(),
        fsImpl = fs
    } = {}) {
        if (!templateRoot || !runtimeRoot) throw new TypeError('DesktopRuntimeProvenanceService requires templateRoot and runtimeRoot.');
        this.templateRoot = path.resolve(templateRoot);
        this.runtimeRoot = path.resolve(runtimeRoot);
        this.isPackaged = isPackaged === true;
        this.migrationReportProvider = migrationReportProvider;
        this.environmentProvenanceProvider = environmentProvenanceProvider;
        this.cacheTtlMs = Math.max(0, Number(cacheTtlMs) || 0);
        this.clock = clock;
        this.fs = fsImpl;
        this.cache = null;
        this.samplePromise = null;
    }

    async sample({ force = false } = {}) {
        const now = this.clock();
        if (!force && this.cache && now - this.cache.at <= this.cacheTtlMs) return this.cache.value;
        if (this.samplePromise) return this.samplePromise;
        this.samplePromise = this.#sampleFresh();
        try {
            const value = await this.samplePromise;
            this.cache = { at: this.clock(), value };
            return value;
        } finally {
            this.samplePromise = null;
        }
    }

    async #sampleFresh() {
        try {
            const [template, runtime] = await Promise.all([
                this.#manifest(path.join(this.templateRoot, 'config')),
                this.#manifest(path.join(this.runtimeRoot, 'config'))
            ]);
            const templateOnly = [];
            const runtimeOnly = [];
            const changed = [];
            for (const [relative, digest] of template.files) {
                if (!runtime.files.has(relative)) templateOnly.push(relative);
                else if (runtime.files.get(relative) !== digest) changed.push(relative);
            }
            for (const relative of runtime.files.keys()) {
                if (!template.files.has(relative)) runtimeOnly.push(relative);
            }
            const missingDefaults = templateOnly.length > 0;
            const customized = changed.length > 0 || runtimeOnly.length > 0;
            const connectionRelevant = [...new Set([...templateOnly, ...runtimeOnly, ...changed].filter(relative => (
                relative === 'server.json'
                || relative.startsWith('bots/')
                || relative === 'authentication/login.json'
                || relative === 'skyblock/join.json'
            )))];
            const parity = missingDefaults
                ? 'RUNTIME_INCOMPLETE'
                : customized ? 'RUNTIME_CUSTOMIZED' : 'IN_SYNC';

            return Object.freeze({
                contract: CONTRACT,
                status: missingDefaults ? 'BLOCKED' : 'READY',
                parity,
                configurationSource: this.isPackaged ? 'APPDATA_RUNTIME' : 'APPDATA_RUNTIME_DEV',
                isolatedRuntime: this.templateRoot !== this.runtimeRoot,
                summary: missingDefaults
                    ? `Runtime config is missing ${templateOnly.length} application default file(s).`
                    : customized
                        ? `Runtime config preserves ${changed.length + runtimeOnly.length} customized file(s); ${connectionRelevant.length} can affect connection/startup.`
                        : 'Runtime config matches application defaults.',
                changes: Object.freeze({
                    templateOnly: boundedPaths(templateOnly),
                    runtimeOnly: boundedPaths(runtimeOnly),
                    changed: boundedPaths(changed)
                }),
                connectionRelevant: boundedPaths(connectionRelevant),
                inventory: Object.freeze({
                    templateFiles: template.files.size,
                    runtimeFiles: runtime.files.size,
                    templateBytes: template.bytes,
                    runtimeBytes: runtime.bytes
                }),
                migration: safeMigrationSummary(this.migrationReportProvider?.()),
                environment: this.environmentProvenanceProvider?.() || null,
                sampledAt: new Date(this.clock()).toISOString(),
                sideEffects: 'NONE'
            });
        } catch (error) {
            return Object.freeze({
                contract: CONTRACT,
                status: 'BLOCKED',
                parity: 'UNKNOWN',
                configurationSource: this.isPackaged ? 'APPDATA_RUNTIME' : 'APPDATA_RUNTIME_DEV',
                isolatedRuntime: this.templateRoot !== this.runtimeRoot,
                summary: 'Runtime configuration provenance could not be verified.',
                error: Object.freeze({ code: error?.code || 'DESKTOP_RUNTIME_PROVENANCE_FAILED' }),
                migration: safeMigrationSummary(this.migrationReportProvider?.()),
                environment: this.environmentProvenanceProvider?.() || null,
                sampledAt: new Date(this.clock()).toISOString(),
                sideEffects: 'NONE'
            });
        }
    }

    async #manifest(root) {
        const files = new Map();
        let bytes = 0;
        const rootStat = await this.fs.lstat(root);
        if (rootStat.isSymbolicLink?.() || !rootStat.isDirectory?.()) {
            throw Object.assign(new Error('Runtime provenance requires a regular config directory.'), { code: 'DESKTOP_CONFIG_PROVENANCE_UNSAFE_ROOT' });
        }
        const walk = async (directory, relative = '') => {
            const entries = await this.fs.readdir(directory, { withFileTypes: true });
            entries.sort((left, right) => left.name.localeCompare(right.name));
            for (const entry of entries) {
                if (entry.isSymbolicLink?.()) {
                    throw Object.assign(new Error('Runtime provenance rejects config symlinks.'), { code: 'DESKTOP_CONFIG_PROVENANCE_SYMLINK' });
                }
                const absolute = path.join(directory, entry.name);
                const nextRelative = path.posix.join(relative, entry.name);
                if (entry.isDirectory()) {
                    await walk(absolute, nextRelative);
                    continue;
                }
                if (!entry.isFile()) continue;
                if (files.size >= MAX_FILES) {
                    throw Object.assign(new Error('Runtime provenance file budget exceeded.'), { code: 'DESKTOP_CONFIG_PROVENANCE_FILE_LIMIT' });
                }
                const stat = await this.fs.stat(absolute);
                if (stat.size > MAX_FILE_BYTES || bytes + stat.size > MAX_TOTAL_BYTES) {
                    throw Object.assign(new Error('Runtime provenance byte budget exceeded.'), { code: 'DESKTOP_CONFIG_PROVENANCE_BYTE_LIMIT' });
                }
                const content = await this.fs.readFile(absolute);
                if (content.length > MAX_FILE_BYTES || bytes + content.length > MAX_TOTAL_BYTES) {
                    throw Object.assign(new Error('Runtime provenance byte budget changed during read.'), { code: 'DESKTOP_CONFIG_PROVENANCE_BYTE_LIMIT' });
                }
                bytes += content.length;
                files.set(nextRelative, crypto.createHash('sha256').update(content).digest('hex'));
            }
        };
        await walk(root);
        return { files, bytes };
    }
}

DesktopRuntimeProvenanceService.CONTRACT = CONTRACT;
DesktopRuntimeProvenanceService.LIMITS = Object.freeze({ MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, MAX_REPORTED_PATHS, DEFAULT_CACHE_TTL_MS });
module.exports = DesktopRuntimeProvenanceService;
