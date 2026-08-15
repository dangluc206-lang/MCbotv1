'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

class DiscordPanelStore {
    constructor({ baseDir = process.cwd(), relativePath = 'data/runtime/discord/panels.json', logger = null } = {}) {
        this.filePath = path.resolve(baseDir, relativePath);
        this.logger = logger;
        this.state = null;
        this.writeQueue = Promise.resolve();
    }

    async get(key) {
        const state = await this.#load();
        return state[key] || null;
    }

    async set(key, value) {
        const state = await this.#load();
        state[key] = value;
        const snapshot = JSON.parse(JSON.stringify(state));
        this.writeQueue = this.writeQueue.catch(() => {}).then(() => this.#write(snapshot));
        await this.writeQueue;
        return value;
    }

    async #load() {
        if (this.state) return this.state;
        try {
            this.state = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger?.warn?.('Discord panel store could not be read; recreating it.', { error });
            }
            this.state = {};
        }
        return this.state;
    }

    async #write(state) {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const temp = `${this.filePath}.tmp`;
        await fs.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
        await fs.rename(temp, this.filePath);
    }
}

module.exports = DiscordPanelStore;
