'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const crypto = require('node:crypto');
const WorkflowDefinitionValidator = require('./WorkflowDefinitionValidator');

class CustomModeStore {
    constructor({ baseDir = process.cwd(), validator = new WorkflowDefinitionValidator(), removePath = fsp.rm, mutationCoordinator = null, maxFileBytes = 1024 * 1024 } = {}) {
        this.baseDir = path.resolve(baseDir);
        this.directory = path.join(this.baseDir, 'config', 'modes', 'custom');
        this.validator = validator;
        if (typeof removePath !== 'function') throw new TypeError('CustomModeStore removePath must be a function.');
        this.removePath = removePath;
        this.mutationCoordinator = mutationCoordinator;
        this.maxFileBytes = Math.max(4096, Math.min(8 * 1024 * 1024, Number(maxFileBytes) || 1048576));
        this.lastCleanupWarning = null;
    }

    loadSync() {
        if (!fs.existsSync(this.directory)) return [];
        const files = fs.readdirSync(this.directory).filter(name => name.endsWith('.json')).sort();
        const output = [];
        for (const name of files) {
            const file = path.join(this.directory, name);
            try {
                const stat = fs.lstatSync(file);
                if (!stat.isFile() || stat.isSymbolicLink()) continue;
                if (stat.size > this.maxFileBytes) continue;
                const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
                const definition = this.validator.normalize(raw);
                if (!definition.enabled) continue;
                output.push({ definition, file, relativeFile: path.relative(this.baseDir, file).replaceAll('\\', '/') });
            } catch {
                // A user-authored workflow must never prevent MCbot from booting.
                // Invalid files remain visible through list() so Desktop can repair/delete them.
            }
        }
        return output;
    }

    async list() {
        await fsp.mkdir(this.directory, { recursive: true });
        const files = (await fsp.readdir(this.directory)).filter(name => name.endsWith('.json')).sort();
        const output = [];
        for (const name of files) {
            const file = path.join(this.directory, name);
            try {
                const linkStat = await fsp.lstat(file);
                if (!linkStat.isFile() || linkStat.isSymbolicLink()) {
                    output.push({ file:name, raw:null, valid:false, errors:['Custom mode file must be a regular non-symlink file.'], normalized:null, schemaVersion:1, digest:null, revision:null });
                    continue;
                }
                if (linkStat.size > this.maxFileBytes) {
                    output.push({ file:name, raw:null, valid:false, errors:['Custom mode file exceeds bounded size.'], normalized:null, schemaVersion:1, digest:null, revision:null });
                    continue;
                }
                const buffer = await fsp.readFile(file);
                const raw = JSON.parse(buffer.toString('utf8'));
                const validation = this.validator.validate(raw);
                const digest = crypto.createHash('sha256').update(buffer).digest('hex');
                output.push({ file: name, raw, valid: validation.valid, errors: validation.errors, normalized: validation.value, schemaVersion:1, digest:`sha256:${digest}`, revision:`${linkStat.size}:${Math.trunc(linkStat.mtimeMs)}:${digest.slice(0, 16)}` });
            } catch (error) {
                output.push({ file: name, raw: null, valid: false, errors: [error.message], normalized: null });
            }
        }
        return output;
    }

    async save(value, { expectedDigest = null } = {}) {
        const normalized = this.validator.normalize(value);
        return this.#queueMutation(() => this.#saveNormalized(normalized, { expectedDigest }));
    }

    async #saveNormalized(normalized, { expectedDigest = null } = {}) {
        await fsp.mkdir(this.directory, { recursive: true });
        const file = path.join(this.directory, `${normalized.id}.json`);
        const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
        const payload = `${JSON.stringify(normalized, null, 2)}\n`;
        if (Buffer.byteLength(payload) > this.maxFileBytes) {
            const error = new Error('Custom mode exceeds bounded file size.');
            error.code = 'CUSTOM_MODE_FILE_TOO_LARGE'; throw error;
        }
        let backupFile = null;
        let cleanupWarning = null;
        this.lastCleanupWarning = null;
        try {
            if (fs.existsSync(file)) {
                const linkStat = await fsp.lstat(file);
                if (!linkStat.isFile() || linkStat.isSymbolicLink()) {
                    const error = new Error('Custom mode target must be a regular non-symlink file.');
                    error.code = 'CUSTOM_MODE_UNSAFE_TARGET'; throw error;
                }
                if (linkStat.size > this.maxFileBytes) {
                    const error = new Error('Existing custom mode exceeds bounded file size.');
                    error.code = 'CUSTOM_MODE_FILE_TOO_LARGE'; throw error;
                }
                const current = await fsp.readFile(file);
                const currentDigest = `sha256:${crypto.createHash('sha256').update(current).digest('hex')}`;
                if (expectedDigest && currentDigest !== expectedDigest) {
                    const error = new Error('Custom mode đã thay đổi từ phiên chỉnh sửa hiện tại.');
                    error.code = 'CUSTOM_MODE_REVISION_CONFLICT'; throw error;
                }
                backupFile = `${file}.bak`;
                try {
                    const backupStat = await fsp.lstat(backupFile);
                    if (!backupStat.isFile() || backupStat.isSymbolicLink()) {
                        const error = new Error('Custom mode backup target must be a regular non-symlink file.');
                        error.code = 'CUSTOM_MODE_UNSAFE_BACKUP_TARGET'; throw error;
                    }
                } catch (error) {
                    if (error?.code !== 'ENOENT') throw error;
                }
                await fsp.writeFile(backupFile, current);
            }
            await fsp.writeFile(temp, payload, 'utf8');
            await fsp.rename(temp, file);
        } finally {
            cleanupWarning = await this.#cleanupTemp(temp);
            this.lastCleanupWarning = cleanupWarning;
        }
        const digest = `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`;
        return { file: path.relative(this.baseDir, file).replaceAll('\\', '/'), backupFile: backupFile ? path.relative(this.baseDir, backupFile).replaceAll('\\', '/') : null, definition: normalized, schemaVersion:1, digest, restartRequired: true, cleanupWarning };
    }

    async #cleanupTemp(temp) {
        try {
            await this.removePath(temp, { force: true });
            return null;
        } catch (error) {
            return Object.freeze({
                operation: 'custom-mode-temp-cleanup',
                code: String(error?.code || error?.name || 'ERROR'),
                target: path.basename(temp)
            });
        }
    }

    async remove(id) {
        const safe = String(id || '').trim();
        if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(safe)) throw new TypeError('Mode ID không hợp lệ.');
        return this.#queueMutation(async () => {
            const file = path.join(this.directory, `${safe}.json`);
            await fsp.rm(file, { force: true });
            return { id: safe, removed: true, restartRequired: true };
        });
    }

    #queueMutation(work) {
        return this.mutationCoordinator?.run
            ? this.mutationCoordinator.run('config-set', work)
            : work();
    }
}

module.exports = CustomModeStore;
