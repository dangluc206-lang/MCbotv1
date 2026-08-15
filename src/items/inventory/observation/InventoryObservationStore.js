'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

class InventoryObservationStore {
    constructor({ baseDir, botId, logger = null }) {
        if (!baseDir) throw new TypeError('baseDir is required');
        if (!botId) throw new TypeError('botId is required');
        this.directory = path.join(baseDir, botId);
        this.file = path.join(this.directory, 'inventory.json');
        this.logger = logger;
        this.writeTail = Promise.resolve();
        this.prepared = false;
    }

    async write(snapshot) {
        const current = this.writeTail.catch(() => {}).then(async () => {
            await this.#prepareDirectory();
            const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
            const body = `${JSON.stringify(snapshot, null, 2)}\n`;
            try {
                await fs.writeFile(temp, body, 'utf8');
                try {
                    await fs.rename(temp, this.file);
                } catch (error) {
                    if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
                    await fs.rm(this.file, { force: true });
                    await fs.rename(temp, this.file);
                }
            } finally {
                await fs.rm(temp, { force: true }).catch(() => {});
            }
            return this.file;
        });
        this.writeTail = current.catch(() => {});
        return current;
    }

    async read() {
        try {
            await this.#prepareDirectory();
            await this.writeTail.catch(() => {});
            return JSON.parse(await fs.readFile(this.file, 'utf8'));
        } catch (error) {
            if (error?.code === 'ENOENT') return null;
            this.logger?.warn?.('Failed to read inventory observation.', { error, file: this.file });
            return null;
        }
    }

    async #prepareDirectory() {
        if (this.prepared) return;
        await fs.mkdir(this.directory, { recursive: true });
        try {
            const names = await fs.readdir(this.directory);
            await Promise.all(names
                .filter(name => name.startsWith('inventory.json.') && name.endsWith('.tmp'))
                .map(name => fs.rm(path.join(this.directory, name), { force: true }).catch(() => {})));
        } catch (error) {
            this.logger?.debug?.('Inventory observation temp cleanup skipped.', { error, directory: this.directory });
        }
        this.prepared = true;
    }
}

module.exports = InventoryObservationStore;
