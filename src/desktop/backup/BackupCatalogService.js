'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const CONTRACT = 'mcbot-config-backup-v1';

function hash(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

function contained(root, candidate) {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

class BackupCatalogService {
    constructor({ baseDir, appVersion = 'unknown', schemaVersion = 1, maxCatalogEntries = 50, maxFiles = 300, maxBytes = 32 * 1024 * 1024, maxManifestBytes = 1024 * 1024, fsImpl = fs, now = Date.now, idFactory = randomUUID } = {}) {
        if (!baseDir) throw new TypeError('BackupCatalogService baseDir is required.');
        this.baseDir = path.resolve(baseDir);
        this.configRoot = path.join(this.baseDir, 'config');
        this.backupRoot = path.join(this.baseDir, 'data', 'backups', 'catalog');
        this.appVersion = String(appVersion);
        this.schemaVersion = schemaVersion;
        this.maxCatalogEntries = Math.max(1, Math.min(500, Number(maxCatalogEntries) || 50));
        this.maxFiles = Math.max(1, Math.min(2000, Number(maxFiles) || 300));
        this.maxBytes = Math.max(1024, Number(maxBytes) || 33554432);
        this.maxManifestBytes = Math.max(4096, Math.min(8 * 1024 * 1024, Number(maxManifestBytes) || 1048576));
        this.fs = fsImpl;
        this.now = now;
        this.idFactory = idFactory;
        this.active = new Set();
        this.transactionActive = false;
    }

    async create(options = {}) {
        if (this.transactionActive) throw Object.assign(new Error('A backup transaction is already active.'), { code:'CONFIG_BACKUP_BUSY' });
        this.transactionActive = true;
        try { return await this.#create(options); }
        finally { this.transactionActive = false; }
    }

    async #create({ reason = 'manual', sourceAction = 'desktop-backup' } = {}) {
        const id = `backup-${new Date(this.now()).toISOString().replace(/[:.]/g, '-')}-${this.idFactory().slice(0, 8)}`;
        const directory = path.join(this.backupRoot, id);
        this.active.add(id);
        try {
            const files = await this.#readConfigFiles();
            await this.fs.mkdir(directory, { recursive: true });
            for (const file of files) {
                const target = path.join(directory, 'files', file.path);
                await this.fs.mkdir(path.dirname(target), { recursive: true });
                await this.fs.writeFile(target, file.buffer, { mode: 0o600 });
            }
            const manifest = {
                contract: CONTRACT,
                version: 1,
                id,
                reason: String(reason).slice(0, 200),
                sourceAction: String(sourceAction).slice(0, 100),
                appVersion: this.appVersion,
                schemaVersion: this.schemaVersion,
                createdAt: new Date(this.now()).toISOString(),
                totalBytes: files.reduce((sum, file) => sum + file.buffer.length, 0),
                files: files.map(file => ({ path: file.path, bytes: file.buffer.length, sha256: hash(file.buffer) }))
            };
            await this.#atomicJson(path.join(directory, 'manifest.json'), manifest);
            await this.enforceRetention();
            return { id, path: directory, createdAt: manifest.createdAt, manifest };
        } catch (error) {
            await this.fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
            throw error;
        } finally { this.active.delete(id); }
    }

    async list({ limit = 20 } = {}) {
        const output = await this.#listAll();
        return output.slice(0, Math.max(1, Math.min(this.maxCatalogEntries, Number(limit) || 20)));
    }

    async #listAll() {
        await this.fs.mkdir(this.backupRoot, { recursive: true });
        const entries = (await this.fs.readdir(this.backupRoot, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.isSymbolicLink());
        const output = [];
        for (const entry of entries) {
            try {
                const manifest = await this.#readManifest(path.join(this.backupRoot, entry.name));
                const validation = await this.verifyManifest(manifest, path.join(this.backupRoot, entry.name));
                output.push({ id: entry.name, createdAt: manifest.createdAt, reason: manifest.reason, sourceAction: manifest.sourceAction, appVersion: manifest.appVersion, schemaVersion: manifest.schemaVersion, totalBytes: manifest.totalBytes, fileCount: manifest.files?.length || 0, integrity: validation.valid ? 'VALID' : 'INVALID', compatible: manifest.schemaVersion === this.schemaVersion });
            } catch (error) {
                output.push({ id: entry.name, integrity: 'INVALID', compatible: false, error: error.message });
            }
        }
        return output.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0) || b.id.localeCompare(a.id));
    }

    async previewRestore(id) {
        const { directory, manifest } = await this.#load(id);
        const verified = await this.verifyManifest(manifest, directory);
        if (!verified.valid) throw Object.assign(new Error(`Backup integrity failed: ${verified.errors.join(', ')}`), { code: 'CONFIG_BACKUP_INTEGRITY_FAILED' });
        const current = new Map((await this.#readConfigFiles()).map(file => [file.path, hash(file.buffer)]));
        const desired = new Set(manifest.files.map(file => file.path));
        const changes = [
            ...manifest.files.map(file => ({ path: file.path, action: !current.has(file.path) ? 'ADD' : current.get(file.path) === file.sha256 ? 'UNCHANGED' : 'REPLACE' })),
            ...[...current.keys()].filter(file => !desired.has(file)).map(file => ({ path:file, action:'DELETE' }))
        ].sort((a,b) => a.path.localeCompare(b.path));
        return { id, compatible: manifest.schemaVersion === this.schemaVersion, integrity: 'VALID', changes, manifest };
    }

    async restore(id, { verifyTarget = null } = {}) {
        if (this.transactionActive) throw Object.assign(new Error('A backup transaction is already active.'), { code: 'CONFIG_BACKUP_BUSY' });
        this.transactionActive = true;
        this.active.add(id);
        let rollback = null;
        try {
            const preview = await this.previewRestore(id);
            if (!preview.compatible) throw Object.assign(new Error('Backup schema is incompatible.'), { code: 'CONFIG_BACKUP_INCOMPATIBLE' });
            rollback = await this.#create({ reason: `pre-restore:${id}`, sourceAction: 'restore-rollback' });
            await this.#applyManifest(path.join(this.backupRoot, id), preview.manifest, { exactTree:true });
            if (verifyTarget) await verifyTarget();
            return { restored: id, rollbackBackupId: rollback.id, changes: preview.changes };
        } catch (error) {
            if (!rollback) throw error;
            const rollbackLoaded = await this.#load(rollback.id);
            await this.#applyManifest(rollbackLoaded.directory, rollbackLoaded.manifest, { exactTree:true });
            throw Object.assign(error, { rollbackBackupId: rollback.id, rollbackApplied: true });
        } finally {
            this.active.delete(id);
            this.transactionActive = false;
        }
    }

    async verifyManifest(manifest, directory) {
        const errors = [];
        if (manifest?.contract !== CONTRACT || manifest?.version !== 1 || !Array.isArray(manifest.files)) errors.push('manifest-contract');
        if ((manifest?.files?.length || 0) > this.maxFiles) errors.push('file-count');
        let bytes = 0;
        const seenPaths = new Set();
        for (const file of manifest?.files || []) {
            if (!this.#validRelative(file.path)) { errors.push(`unsafe-path:${file.path}`); continue; }
            if (seenPaths.has(file.path)) { errors.push(`duplicate-path:${file.path}`); continue; }
            seenPaths.add(file.path);
            if (!Number.isInteger(file.bytes) || file.bytes < 0 || !/^[0-9a-f]{64}$/.test(String(file.sha256 || ''))) { errors.push(`invalid-entry:${file.path}`); continue; }
            try {
                const target = path.join(directory, 'files', file.path);
                const stat = await this.fs.lstat(target);
                if (!stat.isFile() || stat.isSymbolicLink()) { errors.push(`unsafe-file:${file.path}`); continue; }
                const buffer = await this.fs.readFile(target);
                bytes += buffer.length;
                if (buffer.length !== file.bytes || hash(buffer) !== file.sha256) errors.push(`digest:${file.path}`);
            } catch { errors.push(`missing:${file.path}`); }
            if (bytes > this.maxBytes) errors.push('total-bytes');
        }
        if (bytes !== Number(manifest?.totalBytes || 0)) errors.push('manifest-total');
        return { valid: errors.length === 0, errors, bytes };
    }

    async enforceRetention() {
        const entries = await this.#listAll();
        for (const entry of entries.slice(this.maxCatalogEntries)) {
            if (!this.active.has(entry.id)) await this.fs.rm(path.join(this.backupRoot, entry.id), { recursive: true, force: true });
        }
    }

    async #load(id) {
        const safeId = String(id || '');
        if (!/^backup-[a-z0-9._-]+$/i.test(safeId)) throw new TypeError('Invalid backup id.');
        const directory = path.join(this.backupRoot, safeId);
        if (!contained(this.backupRoot, directory)) throw new Error('Backup path escapes catalog.');
        const rootReal = await this.fs.realpath(this.backupRoot);
        const stat = await this.fs.lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw Object.assign(new Error('Backup directory is not a regular catalog directory.'), { code:'CONFIG_BACKUP_UNSAFE_PATH' });
        const directoryReal = await this.fs.realpath(directory);
        if (!contained(rootReal, directoryReal)) throw Object.assign(new Error('Backup directory escapes catalog.'), { code:'CONFIG_BACKUP_UNSAFE_PATH' });
        const manifest = await this.#readManifest(directory);
        return { directory, manifest };
    }

    async #readManifest(directory) {
        const target = path.join(directory, 'manifest.json');
        const stat = await this.fs.lstat(target);
        if (!stat.isFile() || stat.isSymbolicLink()) throw Object.assign(new Error('Backup manifest is not a regular file.'), { code:'CONFIG_BACKUP_UNSAFE_PATH' });
        if (stat.size > this.maxManifestBytes) throw Object.assign(new Error('Backup manifest exceeds bounded quota.'), { code:'CONFIG_BACKUP_MANIFEST_TOO_LARGE' });
        return JSON.parse(await this.fs.readFile(target, 'utf8'));
    }

    async #readConfigFiles() {
        const files = [];
        let total = 0;
        const walk = async directory => {
            for (const entry of await this.fs.readdir(directory, { withFileTypes: true })) {
                if (entry.isSymbolicLink()) throw new Error('Config backup rejects symlinks.');
                const target = path.join(directory, entry.name);
                if (entry.isDirectory()) await walk(target);
                else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
                    const relative = path.relative(this.configRoot, target).replaceAll(path.sep, '/');
                    if (!this.#validRelative(relative)) throw new Error('Unsafe config path.');
                    const buffer = await this.fs.readFile(target);
                    total += buffer.length;
                    if (files.length >= this.maxFiles || total > this.maxBytes) throw new Error('Configuration backup exceeds bounded quota.');
                    files.push({ path: relative, buffer });
                }
            }
        };
        await walk(this.configRoot);
        return files.sort((a, b) => a.path.localeCompare(b.path));
    }

    async #applyManifest(directory, manifest, { exactTree = false } = {}) {
        for (const file of manifest.files) {
            const source = path.join(directory, 'files', file.path);
            const target = path.join(this.configRoot, file.path);
            if (!contained(this.configRoot, target)) throw new Error('Restore target escapes config root.');
            const buffer = await this.fs.readFile(source);
            if (hash(buffer) !== file.sha256) throw new Error(`Restore source digest changed: ${file.path}`);
            await this.fs.mkdir(path.dirname(target), { recursive: true });
            const temp = `${target}.${process.pid}.${this.idFactory()}.tmp`;
            try {
                await this.fs.writeFile(temp, buffer, { mode: 0o600 });
                await this.fs.rename(temp, target);
            } finally { await this.fs.rm(temp, { force: true }).catch(() => undefined); }
        }
        if (exactTree) {
            const desired = new Set(manifest.files.map(file => file.path));
            const current = await this.#readConfigFiles();
            for (const file of current) {
                if (desired.has(file.path)) continue;
                const target = path.join(this.configRoot, file.path);
                if (!contained(this.configRoot, target)) throw new Error('Restore delete target escapes config root.');
                await this.fs.rm(target, { force:true });
            }
        }
    }

    #validRelative(relative) {
        return typeof relative === 'string' && relative.endsWith('.json') && !path.isAbsolute(relative) && !relative.split(/[\\/]/).includes('..') && !relative.includes('\0');
    }

    async #atomicJson(target, value) {
        const temp = `${target}.${process.pid}.${this.idFactory()}.tmp`;
        try {
            await this.fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
            await this.fs.rename(temp, target);
        } finally { await this.fs.rm(temp, { force: true }).catch(() => undefined); }
    }
}

BackupCatalogService.CONTRACT = CONTRACT;
BackupCatalogService.hash = hash;
module.exports = BackupCatalogService;
