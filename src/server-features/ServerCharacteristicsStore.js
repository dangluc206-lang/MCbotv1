'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

class ServerCharacteristicsStore {
    constructor({ baseDir = process.cwd(), relativePath = 'data/runtime/server-characteristics.json', logger = null } = {}) {
        this.filePath = path.resolve(baseDir, relativePath);
        this.relativePath = relativePath;
        this.logger = logger;
        this.loaded = false;
        this.data = { version: 1, servers: {} };
        this.writeChain = Promise.resolve();
    }

    async get(serverKey, featureKey) {
        await this.#ensureLoaded();
        const value = this.data.servers?.[serverKey]?.[featureKey];
        return value === undefined ? null : this.#clone(value);
    }

    async set(serverKey, featureKey, value) {
        if (!serverKey || !featureKey) throw new TypeError('serverKey and featureKey are required');
        await this.#ensureLoaded();
        if (!this.data.servers[serverKey]) this.data.servers[serverKey] = {};
        this.data.servers[serverKey][featureKey] = this.#clone(value);
        this.data.servers[serverKey].updatedAt = new Date().toISOString();
        await this.#persist();
        return this.#clone(this.data.servers[serverKey][featureKey]);
    }

    async remove(serverKey, featureKey) {
        await this.#ensureLoaded();
        const server = this.data.servers?.[serverKey];
        if (!server || !(featureKey in server)) return false;
        delete server[featureKey];
        server.updatedAt = new Date().toISOString();
        await this.#persist();
        return true;
    }

    async snapshot(serverKey) {
        await this.#ensureLoaded();
        return this.#clone(this.data.servers?.[serverKey] || {});
    }

    async #ensureLoaded() {
        if (this.loaded) return;
        this.loaded = true;
        try {
            const text = await fs.readFile(this.filePath, 'utf8');
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === 'object' && parsed.servers && typeof parsed.servers === 'object') {
                this.data = { version: Number(parsed.version || 1), servers: parsed.servers };
            }
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                this.logger?.warn?.('Server characteristics store could not be loaded; starting with an empty store.', {
                    file: this.relativePath,
                    error
                });
            }
        }
    }

    async #persist() {
        this.writeChain = this.writeChain.then(async () => {
            await fs.mkdir(path.dirname(this.filePath), { recursive: true });
            const temp = `${this.filePath}.tmp`;
            await fs.writeFile(temp, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
            await fs.rename(temp, this.filePath);
        });
        return this.writeChain;
    }

    #clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }
}

module.exports = ServerCharacteristicsStore;
