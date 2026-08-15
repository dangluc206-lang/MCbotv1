'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

class CollectorB5ConfigEditor {
    constructor({ baseDir = process.cwd(), configuration, botRegistry, botId, logger = null }) {
        this.baseDir = path.resolve(baseDir);
        this.configuration = configuration;
        this.botRegistry = botRegistry;
        this.botId = botId;
        this.logger = logger;
        this.relativePath = 'config/modes/collector-b5.json';
        this.filePath = path.resolve(this.baseDir, this.relativePath);
        this.backupDir = path.resolve(this.baseDir, 'data/runtime/discord/config-backups');
    }

    async read() {
        const text = await fs.readFile(this.filePath, 'utf8');
        return JSON.parse(text);
    }

    async setPickupLocation({ x, y, z }) {
        const next = await this.#edit(config => {
            config.pickupLocation = {
                x: this.#finite(x, 'X'),
                y: this.#finite(y, 'Y'),
                z: this.#finite(z, 'Z')
            };
        });
        return next;
    }

    async setCraftLoopDelayMs(milliseconds) {
        const value = this.#positive(milliseconds, 'Craft loop delay');
        return this.#edit(config => { config.craftLoopDelayMs = Math.round(value); });
    }

    async setPollSeconds(seconds) {
        const value = this.#positive(seconds, 'Poll');
        return this.#edit(config => { config.pollIntervalMs = Math.round(value * 1000); });
    }

    async setReanchorRadius(radius) {
        const value = this.#positive(radius, 'Reanchor radius');
        return this.#edit(config => { config.reanchorRadius = value; });
    }

    async reload() {
        const loaded = await this.configuration.service.reload('collectorB5Mode', this.filePath, null);
        if (!loaded.success) throw loaded.error || new Error(loaded.message || 'Không reload được collector+B5 config.');
        this.#applyRuntime(loaded.data);
        return loaded.data;
    }

    async #edit(mutator) {
        const current = await this.read();
        const next = JSON.parse(JSON.stringify(current));
        mutator(next);
        this.#validate(next);

        await fs.mkdir(this.backupDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(this.backupDir, `collector-b5-${stamp}.json`);
        await fs.writeFile(backupPath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
        await this.#pruneBackups('collector-b5', 30);

        const temp = `${this.filePath}.discord.tmp`;
        try {
            await fs.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
            await fs.rename(temp, this.filePath);
            const loaded = await this.configuration.service.reload('collectorB5Mode', this.filePath, null);
            if (!loaded.success) throw loaded.error || new Error(loaded.message || 'Config reload failed.');
            this.#applyRuntime(loaded.data);
            this.logger?.info?.('Collector+B5 config updated from Discord.', {
                botId: this.botId,
                file: this.relativePath
            });
            return loaded.data;
        } catch (error) {
            await fs.writeFile(this.filePath, `${JSON.stringify(current, null, 2)}\n`, 'utf8').catch(() => {});
            await this.configuration.service.reload('collectorB5Mode', this.filePath, null).catch(() => {});
            try { this.#applyRuntime(current); } catch {}
            throw error;
        } finally {
            await fs.rm(temp, { force: true }).catch(() => {});
        }
    }

    async #pruneBackups(prefix, keep) {
        const entries = await fs.readdir(this.backupDir, { withFileTypes: true }).catch(() => []);
        const names = entries.filter(entry => entry.isFile() && entry.name.startsWith(`${prefix}-`) && entry.name.endsWith('.json')).map(entry => entry.name).sort().reverse();
        await Promise.all(names.slice(keep).map(name => fs.rm(path.join(this.backupDir, name), { force: true })));
    }

    #applyRuntime(config) {
        const runtime = this.botRegistry.require(this.botId);
        runtime.requireService('collectorB5Mode').reconfigure(config);
    }

    #validate(config) {
        const p = config.pickupLocation || {};
        for (const axis of ['x', 'y', 'z']) {
            if (p[axis] !== null && p[axis] !== undefined && !Number.isFinite(Number(p[axis]))) {
                throw new Error(`pickupLocation.${axis} phải là số.`);
            }
        }
        for (const key of ['pollIntervalMs', 'craftLoopDelayMs', 'reanchorRadius']) {
            if (!Number.isFinite(Number(config[key])) || Number(config[key]) <= 0) {
                throw new Error(`${key} phải lớn hơn 0.`);
            }
        }
    }

    #finite(value, label) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) throw new Error(`${label} phải là số.`);
        return parsed;
    }

    #positive(value, label) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} phải lớn hơn 0.`);
        return parsed;
    }
}

module.exports = CollectorB5ConfigEditor;
