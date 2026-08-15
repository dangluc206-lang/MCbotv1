'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const resolveFishingConfig = require('../../modes/fishing/resolveFishingConfig');

class FishingBotConfigEditor {
    constructor({ baseDir = process.cwd(), configuration, botRegistry, logger = null }) {
        this.baseDir = path.resolve(baseDir);
        this.configuration = configuration;
        this.botRegistry = botRegistry;
        this.logger = logger;
        this.botConfigDir = path.resolve(this.baseDir, 'config/bots');
        this.backupDir = path.resolve(this.baseDir, 'data/runtime/discord/config-backups');
    }

    async listBotIds() {
        let entries;
        try {
            entries = await fs.readdir(this.botConfigDir, { withFileTypes: true });
        } catch (error) {
            if (error?.code === 'ENOENT') return this.botRegistry?.ids?.() || [];
            throw error;
        }
        const ids = [];
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
            try {
                const profile = JSON.parse(await fs.readFile(path.join(this.botConfigDir, entry.name), 'utf8'));
                if (typeof profile.id === 'string' && profile.id.trim()) ids.push(profile.id.trim());
            } catch {}
        }
        return [...new Set(ids)].sort();
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

    async setAreaPosition({ botId, areaId, x, y, z, pitchDegrees }) {
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

    async reloadBot(botId) {
        const { profile } = await this.#readProfile(botId);
        return this.#applyRuntime(botId, profile);
    }

    async #edit(botId, mutator) {
        const { filePath, profile: current } = await this.#readProfile(botId);
        const next = JSON.parse(JSON.stringify(current));
        mutator(next);
        this.configuration.validator.assertValid('bot', next);

        await fs.mkdir(this.backupDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(this.backupDir, `${botId}-fishing-${stamp}.json`);
        await fs.writeFile(backupPath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
        await this.#pruneBackups(`${botId}-fishing`, 30);

        const temp = `${filePath}.discord.tmp`;
        try {
            await fs.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
            await fs.rename(temp, filePath);
            const resolved = await this.#applyRuntime(botId, next);
            this.logger?.info?.('Per-bot fishing config updated from Discord.', {
                botId,
                file: path.relative(this.baseDir, filePath)
            });
            return resolved;
        } catch (error) {
            await fs.writeFile(filePath, `${JSON.stringify(current, null, 2)}\n`, 'utf8').catch(() => {});
            await this.#applyRuntime(botId, current).catch(() => {});
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
        const entries = await fs.readdir(this.botConfigDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
            const filePath = path.join(this.botConfigDir, entry.name);
            let profile;
            try {
                profile = JSON.parse(await fs.readFile(filePath, 'utf8'));
            } catch {
                continue;
            }
            if (profile?.id === botId) return { filePath, profile };
        }
        throw new Error(`Không tìm thấy config bot: ${botId}`);
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
