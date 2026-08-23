'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const WorkflowDefinitionValidator = require('./WorkflowDefinitionValidator');

class CustomModeStore {
    constructor({ baseDir = process.cwd(), validator = new WorkflowDefinitionValidator(), removePath = fsp.rm, mutationCoordinator = null } = {}) {
        this.baseDir = path.resolve(baseDir);
        this.directory = path.join(this.baseDir, 'config', 'modes', 'custom');
        this.validator = validator;
        if (typeof removePath !== 'function') throw new TypeError('CustomModeStore removePath must be a function.');
        this.removePath = removePath;
        this.mutationCoordinator = mutationCoordinator;
        this.lastCleanupWarning = null;
    }

    loadSync() {
        if (!fs.existsSync(this.directory)) return [];
        const files = fs.readdirSync(this.directory).filter(name => name.endsWith('.json')).sort();
        const output = [];
        for (const name of files) {
            const file = path.join(this.directory, name);
            try {
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
                const raw = JSON.parse(await fsp.readFile(file, 'utf8'));
                const validation = this.validator.validate(raw);
                output.push({ file: name, raw, valid: validation.valid, errors: validation.errors, normalized: validation.value });
            } catch (error) {
                output.push({ file: name, raw: null, valid: false, errors: [error.message], normalized: null });
            }
        }
        return output;
    }

    async save(value) {
        const normalized = this.validator.normalize(value);
        return this.#queueMutation(() => this.#saveNormalized(normalized));
    }

    async #saveNormalized(normalized) {
        await fsp.mkdir(this.directory, { recursive: true });
        const file = path.join(this.directory, `${normalized.id}.json`);
        const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
        const payload = `${JSON.stringify(normalized, null, 2)}\n`;
        let backupFile = null;
        let cleanupWarning = null;
        this.lastCleanupWarning = null;
        try {
            if (fs.existsSync(file)) {
                backupFile = `${file}.bak`;
                await fsp.writeFile(backupFile, await fsp.readFile(file));
            }
            await fsp.writeFile(temp, payload, 'utf8');
            await fsp.rename(temp, file);
        } finally {
            cleanupWarning = await this.#cleanupTemp(temp);
            this.lastCleanupWarning = cleanupWarning;
        }
        return { file: path.relative(this.baseDir, file).replaceAll('\\', '/'), backupFile: backupFile ? path.relative(this.baseDir, backupFile).replaceAll('\\', '/') : null, definition: normalized, restartRequired: true, cleanupWarning };
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
