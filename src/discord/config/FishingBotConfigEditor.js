'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const resolveFishingConfig = require('../../modes/fishing/resolveFishingConfig');

class FishingBotConfigEditor {
    constructor({ baseDir = process.cwd(), configuration, botRegistry, logger = null, mutationCoordinator = null }) {
        this.baseDir = path.resolve(baseDir);
        this.configuration = configuration;
        this.botRegistry = botRegistry;
        this.logger = logger;
        this.mutationCoordinator = mutationCoordinator;
        this.botConfigDir = path.resolve(this.baseDir, 'config/bots');
        this.backupDir = path.resolve(this.baseDir, 'data/runtime/discord/config-backups');
    }

    async listBotIds() {
        const profiles = await this.#readProfiles({ allowMissing: true });
        if (profiles.length === 0) return this.botRegistry?.ids?.() || [];
        return profiles.map(entry => entry.profile.id).sort();
    }

    async read(botId) {
        const { filePath, profile } = await this.#readProfile(botId);
        const shared = this.configuration.registry.require('fishingMode');
        return {
            botId,
            filePath,
            profile,
            overrides: profile.fishing || {},
            resolved: resolveFishingConfig(shared, profile.fishing || {})
        };
    }

    setAreaPosition(args) { return this.#queueMutation(() => this.#setAreaPosition(args)); }

    async #setAreaPosition({ botId, areaId, x, y, z, pitchDegrees }) {
        const parsed = {
            x: this.#finite(x, 'X'),
            y: this.#finite(y, 'Y'),
            z: this.#finite(z, 'Z')
        };
        const pitch = this.#range(pitchDegrees, 'Góc cúi', 0, 89);

        return this.#edit(botId, profile => {
            const shared = this.configuration.registry.require('fishingMode');
            if (!Array.isArray(shared.areas) || !shared.areas.some(area => area.id === areaId)) {
                throw new Error(`Khu AFK không tồn tại: ${areaId}`);
            }
            if (!profile.fishing || typeof profile.fishing !== 'object' || Array.isArray(profile.fishing)) {
                profile.fishing = {};
            }
            if (!profile.fishing.areas || typeof profile.fishing.areas !== 'object' || Array.isArray(profile.fishing.areas)) {
                profile.fishing.areas = {};
            }
            profile.fishing.areas[areaId] = parsed;
            profile.fishing.shoreFishingPitchDegrees = pitch;
        });
    }

    reloadBot(botId) { return this.#queueMutation(() => this.#reloadBot(botId)); }

    async #reloadBot(botId) {
        const profiles = await this.#readProfiles();
        const found = profiles.find(entry => entry.profile.id === botId);
        if (!found) throw new Error(`Không tìm thấy config bot: ${botId}`);
        this.configuration.crossValidator?.assertValid(this.configuration.registry.snapshot(), {
            botProfiles: profiles.map(entry => entry.profile)
        });
        const { profile } = found;
        return this.#applyRuntime(botId, profile);
    }


    #queueMutation(work) {
        return this.mutationCoordinator?.run
            ? this.mutationCoordinator.run('bot-profile-set', work)
            : work();
    }

    async #edit(botId, mutator) {
        const { filePath, profile: current } = await this.#readProfile(botId);
        const next = JSON.parse(JSON.stringify(current));
        mutator(next);
        this.configuration.validator.assertValid('bot', next);
        const profiles = await this.#readProfiles();
        const candidates = profiles.map(entry => entry.profile.id === botId ? next : entry.profile);
        this.configuration.crossValidator?.assertValid(this.configuration.registry.snapshot(), {
            botProfiles: candidates
        });

        await fs.mkdir(this.backupDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(this.backupDir, `${botId}-fishing-${stamp}.json`);
        await fs.writeFile(backupPath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
        await this.#pruneBackups(`${botId}-fishing`, 30);

        let fileReplaced = false;
        try {
            await this.#atomicWrite(filePath, next);
            fileReplaced = true;
            const resolved = await this.#applyRuntime(botId, next);
            this.logger?.info?.('Per-bot fishing config updated from Discord.', {
                botId,
                file: path.relative(this.baseDir, filePath)
            });
            return resolved;
        } catch (error) {
            const rollbackErrors = [];
            if (fileReplaced) {
                try {
                    await this.#atomicWrite(filePath, current);
                } catch (caught) {
                    rollbackErrors.push(caught);
                    this.logger?.error?.('Fishing bot config file rollback failed.', { botId, file: filePath, error: caught });
                }
                try {
                    await this.#applyRuntime(botId, current);
                } catch (caught) {
                    rollbackErrors.push(caught);
                    this.logger?.error?.('Fishing bot runtime rollback failed.', { botId, error: caught });
                }
            }
            if (rollbackErrors.length > 0) {
                throw new AggregateError([error, ...rollbackErrors], 'Fishing bot config update and rollback failed.');
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

    async #applyRuntime(botId, profile) {
        const shared = this.configuration.registry.require('fishingMode');
        const resolved = resolveFishingConfig(shared, profile.fishing || {});
        const runtime = this.botRegistry.get(botId);
        if (!runtime) return resolved;

        const afkAreas = runtime.getService('afkAreas');
        if (afkAreas?.reconfigure) afkAreas.reconfigure(resolved);

        const fishingMode = runtime.requireService('fishingMode');
        if (typeof fishingMode.reconfigure === 'function') {
            await fishingMode.reconfigure(resolved);
        }
        return resolved;
    }

    async #readProfile(botId) {
        if (typeof botId !== 'string' || !botId.trim()) throw new Error('botId không hợp lệ.');
        const profiles = await this.#readProfiles();
        const found = profiles.find(entry => entry.profile.id === botId);
        if (found) return found;
        throw new Error(`Không tìm thấy config bot: ${botId}`);
    }

    async #readProfiles({ allowMissing = false } = {}) {
        let entries;
        try {
            entries = await fs.readdir(this.botConfigDir, { withFileTypes: true });
        } catch (error) {
            if (allowMissing && error.code === 'ENOENT') return [];
            throw error;
        }
        const profiles = [];
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
            const filePath = path.join(this.botConfigDir, entry.name);
            try {
                const profile = JSON.parse(await fs.readFile(filePath, 'utf8'));
                this.configuration.validator.assertValid('bot', profile);
                if (path.basename(entry.name, '.json') !== profile.id) {
                    throw new Error(`Bot profile filename/id mismatch: ${entry.name} contains ${profile.id}`);
                }
                profiles.push({ filePath, profile });
            } catch (error) {
                throw new Error(`Không đọc được bot profile ${entry.name}: ${error.message}`, { cause: error });
            }
        }
        return profiles;
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
                this.logger?.warn?.('Temporary fishing config file cleanup failed.', { file: temp, error });
            }
        }
    }

    #finite(value, label) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) throw new Error(`${label} phải là số.`);
        return parsed;
    }

    #range(value, label, min, max) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
            throw new Error(`${label} phải trong khoảng ${min}-${max}.`);
        }
        return parsed;
    }
}

module.exports = FishingBotConfigEditor;
