'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const createBotRuntime = require('../../bootstrap/createBotRuntime');

class BotProfileAdminService {
    constructor({ baseDir = process.cwd(), configuration, shared, application, environment = process.env, logger = null }) {
        this.baseDir = path.resolve(baseDir);
        this.configuration = configuration;
        this.shared = shared;
        this.application = application;
        this.botRegistry = application.botRegistry;
        this.logger = logger;
        this.environment = environment;
        this.directory = path.resolve(this.baseDir, 'config/bots');
        this.backupDirectory = path.resolve(this.baseDir, 'data/runtime/discord/config-backups');
        this.writeQueue = Promise.resolve();
    }

    async listProfiles() {
        await fs.mkdir(this.directory, { recursive: true });
        const entries = await fs.readdir(this.directory, { withFileTypes: true });
        const profiles = [];
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
            const filePath = path.join(this.directory, entry.name);
            try {
                const profile = JSON.parse(await fs.readFile(filePath, 'utf8'));
                if (profile && typeof profile.id === 'string' && profile.id.trim()) {
                    profiles.push({ ...profile, __filePath: filePath });
                }
            } catch (error) {
                this.logger?.warn?.('Bot profile could not be read.', { file: path.relative(this.baseDir, filePath), error });
            }
        }
        return profiles.sort((a, b) => a.id.localeCompare(b.id));
    }

    async getProfile(botId) {
        const profiles = await this.listProfiles();
        const profile = profiles.find(entry => entry.id === botId);
        if (!profile) throw new Error(`Không tìm thấy profile bot: ${botId}`);
        const { __filePath, ...plain } = profile;
        return { profile: plain, filePath: __filePath };
    }

    async createProfile({ id, displayName = '', username, auth = 'offline', version = '1.21.1', serverProfile = 'default' }) {
        const safeId = this.#normalizeId(id);
        const cleanUsername = this.#requiredText(username, 'Minecraft username');
        const profiles = await this.listProfiles();
        if (profiles.some(entry => entry.id === safeId)) throw new Error(`Bot ID đã tồn tại: ${safeId}`);
        const profile = {
            id: safeId,
            displayName: String(displayName || '').trim() || safeId,
            enabled: false,
            username: cleanUsername,
            auth: String(auth || 'offline').trim() || 'offline',
            version: this.#normalizeVersion(version),
            serverProfile: String(serverProfile || 'default').trim() || 'default',
            role: 'worker',
            readyTimeoutMs: 30000,
            reconnect: { enabled: true, maxAttempts: 20, baseDelayMs: 5000, maxDelayMs: 60000 }
        };
        this.configuration.validator.assertValid('bot', profile);
        const filePath = path.join(this.directory, `${safeId}.json`);
        await this.#queueWrite(async () => {
            await fs.mkdir(this.directory, { recursive: true });
            await this.#atomicWrite(filePath, profile);
        });
        try {
            await this.#replaceRuntime(profile, { start: false });
        } catch (error) {
            await this.#queueWrite(() => fs.rm(filePath, { force: true }));
            this.logger?.error?.('Bot profile creation rolled back because runtime initialization failed.', { botId: safeId, error });
            throw error;
        }
        this.logger?.info?.('Bot profile created from Discord.', { botId: safeId, username: cleanUsername });
        return profile;
    }

    async updateProfile(botId, fields = {}) {
        const { profile: current, filePath } = await this.getProfile(botId);
        const next = JSON.parse(JSON.stringify(current));
        if (fields.displayName !== undefined) next.displayName = String(fields.displayName || '').trim() || next.id;
        if (fields.username !== undefined) next.username = this.#requiredText(fields.username, 'Minecraft username');
        if (fields.auth !== undefined) next.auth = String(fields.auth || 'offline').trim() || 'offline';
        if (fields.version !== undefined) next.version = this.#normalizeVersion(fields.version);
        if (fields.serverProfile !== undefined) next.serverProfile = String(fields.serverProfile || 'default').trim() || 'default';
        if (fields.enabled !== undefined) next.enabled = Boolean(fields.enabled);
        this.configuration.validator.assertValid('bot', next);
        if (next.enabled) await this.#assertUniqueEnabledUsername(next);
        await this.#queueWrite(async () => {
            await this.#backup(current, `${botId}-profile`);
            await this.#atomicWrite(filePath, next);
        });
        try {
            await this.#replaceRuntime(next, { start: next.enabled });
        } catch (error) {
            this.logger?.error?.('Bot profile update failed; restoring previous profile/runtime.', { botId, error });
            await this.#queueWrite(() => this.#atomicWrite(filePath, current));
            try {
                await this.#replaceRuntime(current, { start: current.enabled });
            } catch (rollbackError) {
                this.logger?.error?.('Bot profile runtime rollback also failed.', { botId, error: rollbackError });
            }
            throw error;
        }
        this.logger?.info?.('Bot profile updated from Discord.', { botId, enabled: next.enabled, username: next.username });
        return next;
    }

    async setEnabled(botId, enabled) { return this.updateProfile(botId, { enabled: Boolean(enabled) }); }

    async reloadRuntime(botId) {
        const { profile } = await this.getProfile(botId);
        if (profile.enabled) await this.#assertUniqueEnabledUsername(profile);
        return this.#replaceRuntime(profile, { start: profile.enabled });
    }

    async connect(botId) {
        const runtime = this.botRegistry.require(botId);
        return runtime.requireService('connectionManager').connect();
    }

    async disconnect(botId, reason = 'Disconnected from Discord bot admin.') {
        const runtime = this.botRegistry.require(botId);
        await this.#stopModes(runtime, reason);
        runtime.getService?.('operationManager')?.cancelAll?.(reason);
        await runtime.getService?.('movementManager')?.stop?.();
        await runtime.getService?.('guiManager')?.closeCurrentWindow?.();
        await runtime.requireService('connectionManager').stop();
        return { success: true };
    }

    async connectEnabledAll() {
        const profiles = (await this.listProfiles()).filter(profile => profile.enabled);
        const results = await Promise.allSettled(profiles.map(profile => this.connect(profile.id)));
        return {
            total: profiles.length,
            fulfilled: results.filter(result => result.status === 'fulfilled').length,
            rejected: results.filter(result => result.status === 'rejected').length
        };
    }

    async disconnectAll(reason = 'Fleet disconnect from Discord bot admin.') {
        const runtimes = this.botRegistry.list();
        const results = await Promise.allSettled(runtimes.map(runtime => this.disconnect(runtime.botId, reason)));
        return {
            total: runtimes.length,
            fulfilled: results.filter(result => result.status === 'fulfilled').length,
            rejected: results.filter(result => result.status === 'rejected').length
        };
    }

    async stopAllModes(reason = 'Fleet mode stop from Discord bot admin.') {
        const runtimes = this.botRegistry.list();
        const results = await Promise.allSettled(runtimes.map(async runtime => {
            await this.#stopModes(runtime, reason);
                runtime.getService?.('operationManager')?.cancelAll?.(reason);
            await runtime.getService?.('movementManager')?.stop?.();
            await runtime.getService?.('guiManager')?.closeCurrentWindow?.();
        }));
        return {
            total: runtimes.length,
            fulfilled: results.filter(result => result.status === 'fulfilled').length,
            rejected: results.filter(result => result.status === 'rejected').length
        };
    }

    async cloneProfile(sourceBotId, newId) {
        const { profile: source } = await this.getProfile(sourceBotId);
        const safeId = this.#normalizeId(newId);
        const profiles = await this.listProfiles();
        if (profiles.some(entry => entry.id === safeId)) throw new Error(`Bot ID đã tồn tại: ${safeId}`);
        const next = JSON.parse(JSON.stringify(source));
        next.id = safeId;
        next.displayName = `${source.displayName || source.id} copy`;
        next.enabled = false;
        const filePath = path.join(this.directory, `${safeId}.json`);
        this.configuration.validator.assertValid('bot', next);
        await this.#queueWrite(() => this.#atomicWrite(filePath, next));
        try {
            await this.#replaceRuntime(next, { start: false });
        } catch (error) {
            await this.#queueWrite(() => fs.rm(filePath, { force: true }));
            this.logger?.error?.('Cloned bot profile rolled back because runtime initialization failed.', { botId: safeId, sourceBotId, error });
            throw error;
        }
        return next;
    }

    async #replaceRuntime(profile, { start = false } = {}) {
        const old = this.botRegistry.get(profile.id);
        if (old) {
            try {
                await this.#stopModes(old, 'Reloading bot runtime from Discord.');
                await old.destroy();
            } finally {
                this.botRegistry.remove(profile.id, old);
            }
        }
        const runtimeProfile = Object.freeze({
            ...profile,
            password: this.environment[`MCBOT_${profile.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_PASSWORD`] || undefined
        });
        let runtime = null;
        try {
            runtime = createBotRuntime({ profile: runtimeProfile, configuration: this.configuration, shared: this.shared });
            this.application.registerRuntime(runtime);
            await runtime.initialize();
            if (start) await runtime.start();
            return runtime;
        } catch (error) {
            if (runtime) {
                await runtime.destroy?.().catch?.(() => {});
                this.botRegistry.remove(profile.id, runtime);
            }
            throw error;
        }
    }

    async #stopModes(runtime, reason) {
        for (const name of ['fishingMode', 'collectorB5Mode']) {
            const mode = runtime.getService?.(name);
            if (mode?.status?.().enabled) await mode.disable(reason).catch(() => {});
        }
    }

    async #assertUniqueEnabledUsername(profile) {
        const username = String(profile.username || '').trim().toLowerCase();
        if (!username) return;
        const profiles = await this.listProfiles();
        const duplicate = profiles.find(entry => entry.id !== profile.id && entry.enabled && String(entry.username || '').trim().toLowerCase() === username);
        if (duplicate) throw new Error(`Username ${profile.username} đang được bot ${duplicate.id} dùng ở trạng thái enabled.`);
    }

    async #backup(data, prefix) {
        await fs.mkdir(this.backupDirectory, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        await fs.writeFile(path.join(this.backupDirectory, `${prefix}-${stamp}.json`), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
        await this.#pruneBackups(prefix, 30);
    }

    async #pruneBackups(prefix, keep) {
        const entries = await fs.readdir(this.backupDirectory, { withFileTypes: true }).catch(() => []);
        const matches = entries.filter(entry => entry.isFile() && entry.name.startsWith(`${prefix}-`) && entry.name.endsWith('.json')).map(entry => entry.name).sort().reverse();
        await Promise.all(matches.slice(keep).map(name => fs.rm(path.join(this.backupDirectory, name), { force: true })));
    }

    async #atomicWrite(filePath, value) {
        const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        try {
            await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
            await fs.rename(temp, filePath);
        } finally {
            await fs.rm(temp, { force: true }).catch(() => {});
        }
    }

    #queueWrite(work) { this.writeQueue = this.writeQueue.catch(() => {}).then(work); return this.writeQueue; }
    #normalizeId(value) {
        const id = String(value || '').trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(id)) throw new Error('Bot ID phải 2-32 ký tự: a-z, 0-9, _ hoặc -; bắt đầu bằng chữ/số.');
        return id;
    }
    #requiredText(value, label) { const text = String(value || '').trim(); if (!text) throw new Error(`${label} không được để trống.`); return text; }
    #normalizeVersion(value) { const text = String(value ?? '').trim(); if (!text || ['false', 'auto', 'detect'].includes(text.toLowerCase())) return false; return text; }
}

module.exports = BotProfileAdminService;
