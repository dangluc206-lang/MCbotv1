'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

class CollectorB5ConfigEditor {
    constructor({ baseDir = process.cwd(), configuration, botRegistry, botId, logger = null, mutationCoordinator = null }) {
        this.baseDir = path.resolve(baseDir);
        this.configuration = configuration;
        this.botRegistry = botRegistry;
        this.botId = botId;
        this.logger = logger;
        this.mutationCoordinator = mutationCoordinator;
        this.relativePath = 'config/modes/collector-b5.json';
        this.filePath = path.resolve(this.baseDir, this.relativePath);
        this.backupDir = path.resolve(this.baseDir, 'data/runtime/discord/config-backups');
    }

    async read() {
        const text = await fs.readFile(this.filePath, 'utf8');
        return JSON.parse(text);
    }

    setPickupLocation({ x, y, z }) {
        return this.#queueMutation(() => this.#edit(config => {
            config.pickupLocation = {
                x: this.#finite(x, 'X'),
                y: this.#finite(y, 'Y'),
                z: this.#finite(z, 'Z')
            };
        }));
    }

    setCraftLoopDelayMs(milliseconds) {
        const value = this.#positive(milliseconds, 'Craft loop delay');
        return this.#queueMutation(() => this.#edit(config => { config.craftLoopDelayMs = Math.round(value); }));
    }

    setPollSeconds(seconds) {
        const value = this.#positive(seconds, 'Poll');
        return this.#queueMutation(() => this.#edit(config => { config.pollIntervalMs = Math.round(value * 1000); }));
    }

    setReanchorRadius(radius) {
        const value = this.#positive(radius, 'Reanchor radius');
        return this.#queueMutation(() => this.#edit(config => { config.reanchorRadius = value; }));
    }

    update(fields = {}) {
        return this.#queueMutation(() => this.#edit(config => {
            if (fields.pickupLocation) {
                const { x, y, z } = fields.pickupLocation;
                config.pickupLocation = { x: this.#finite(x, 'X'), y: this.#finite(y, 'Y'), z: this.#finite(z, 'Z') };
            }
            if (fields.craftLoopDelayMs !== undefined) config.craftLoopDelayMs = Math.round(this.#positive(fields.craftLoopDelayMs, 'Craft loop delay'));
            if (fields.pollSeconds !== undefined) config.pollIntervalMs = Math.round(this.#positive(fields.pollSeconds, 'Poll') * 1000);
            if (fields.reanchorRadius !== undefined) config.reanchorRadius = this.#positive(fields.reanchorRadius, 'Reanchor radius');
        }));
    }

    #queueMutation(work) {
        return this.mutationCoordinator?.run
            ? this.mutationCoordinator.run('config-set', work)
            : work();
    }

    async reload() {
        const loaded = await this.configuration.service.reload('collectorB5Mode', this.filePath, 'collectorB5Mode', {
            apply: config => this.#applyRuntime(config),
            rollback: config => this.#applyRuntime(config)
        });
        if (!loaded.success) throw loaded.error || new Error(loaded.message || 'Không reload được collector+B5 config.');
        return loaded.data;
    }

    async #edit(mutator) {
        const current = await this.read();
        const next = JSON.parse(JSON.stringify(current));
        mutator(next);
        this.configuration.validator.assertValid('collectorB5Mode', next);
        this.configuration.crossValidator?.assertValid({
            ...this.configuration.registry.snapshot(),
            collectorB5Mode: next
        });

        await fs.mkdir(this.backupDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(this.backupDir, `collector-b5-${stamp}.json`);
        await fs.writeFile(backupPath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
        await this.#pruneBackups('collector-b5', 30);

        let fileReplaced = false;
        try {
            await this.#atomicWrite(this.filePath, next);
            fileReplaced = true;
            const loaded = await this.configuration.service.reload('collectorB5Mode', this.filePath, 'collectorB5Mode', {
                apply: config => this.#applyRuntime(config),
                rollback: config => this.#applyRuntime(config)
            });
            if (!loaded.success) throw loaded.error || new Error(loaded.message || 'Config reload failed.');
            this.logger?.info?.('Collector+B5 config updated from Discord.', {
                botId: this.botId,
                file: this.relativePath
            });
            return loaded.data;
        } catch (error) {
            let rollbackError = null;
            if (fileReplaced) {
                try {
                    await this.#atomicWrite(this.filePath, current);
                } catch (caught) {
                    rollbackError = caught;
                    this.logger?.error?.('Collector+B5 config file rollback failed.', {
                        botId: this.botId,
                        file: this.relativePath,
                        error: caught
                    });
                }
            }
            if (rollbackError) {
                throw new AggregateError([error, rollbackError], 'Collector+B5 config update and file rollback both failed.');
            }
            throw error;
        }
    }

    async #pruneBackups(prefix, keep) {
        let entries = [];
        try {
            entries = await fs.readdir(this.backupDir, { withFileTypes: true });
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        const names = entries.filter(entry => entry.isFile() && entry.name.startsWith(`${prefix}-`) && entry.name.endsWith('.json')).map(entry => entry.name).sort().reverse();
        await Promise.all(names.slice(keep).map(name => fs.rm(path.join(this.backupDir, name), { force: true })));
    }

    #applyRuntime(config) {
        const runtime = this.botRegistry.require(this.botId);
        runtime.requireService('collectorB5Mode').reconfigure(config);
    }

    async #atomicWrite(filePath, value) {
        const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        try {
            await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
            await fs.rename(temp, filePath);
        } finally {
            try {
                await fs.rm(temp, { force: true });
            } catch (error) {
                this.logger?.warn?.('Temporary collector+B5 config file cleanup failed.', { file: temp, error });
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
