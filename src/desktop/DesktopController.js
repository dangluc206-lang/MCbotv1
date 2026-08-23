'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const createApplication = require('../bootstrap/createApplication');
const Redactor = require('../shared/security/Redactor');
const CollectorB5ConfigEditor = require('../discord/config/CollectorB5ConfigEditor');
const FishingBotConfigEditor = require('../discord/config/FishingBotConfigEditor');
const ConfigSpecs = require('../configuration/ConfigSpecs');
const CustomModeStore = require('../modes/composable/CustomModeStore');
const WorkflowDefinitionValidator = require('../modes/composable/WorkflowDefinitionValidator');
const DesktopLogPolicy = require('./DesktopLogPolicy');
const VietnamTime = require('../shared/time/VietnamTime');

function plainError(error) {
    if (!error) return null;
    return {
        name: error.name || 'Error',
        code: error.code || null,
        message: error.message || String(error)
    };
}

function resultPayload(result) {
    if (!result || typeof result !== 'object') return result;
    return {
        success: result.success !== false,
        status: result.status || null,
        message: result.message || null,
        data: result.data ?? null,
        error: plainError(result.error)
    };
}

function pick(source, keys) {
    const output = {};
    for (const key of keys) if (Object.prototype.hasOwnProperty.call(source || {}, key)) output[key] = source[key];
    return output;
}

class DesktopController {
    constructor({ baseDir = process.cwd(), environment = process.env, maxLogs = 1200, logPolicy = null } = {}) {
        this.baseDir = path.resolve(baseDir);
        this.environment = { ...environment, MCBOT_DESKTOP: '1' };
        this.maxLogs = Math.max(100, Number(maxLogs) || 1200);
        this.logPolicy = logPolicy || new DesktopLogPolicy({ repeatWindowMs: 15000 });
        this.bundle = null;
        this.lifecycle = 'STOPPED';
        this.logs = [];
        this.logListeners = new Set();
        this.startPromise = null;
        this.startedAt = null;
        this.logPersistenceFailure = null;
        this.logListenerFailure = null;
    }

    onLog(listener) {
        if (typeof listener !== 'function') throw new TypeError('log listener must be a function');
        this.logListeners.add(listener);
        return () => this.logListeners.delete(listener);
    }

    reportRendererError(payload = {}) {
        const message = String(payload?.message || 'Unknown renderer error').slice(0, 2000);
        const stack = payload?.stack ? String(payload.stack).slice(0, 8000) : null;
        this.#publishLog({
            timestamp: VietnamTime.iso(),
            level: 'error',
            scope: 'DesktopRenderer',
            message,
            meta: { stack, source: payload?.source ? String(payload.source).slice(0, 500) : null }
        }, { persist: String(payload?.source || '').toLowerCase() !== 'test' });
        return { success: true };
    }

    logSnapshot({ limit = 300 } = {}) {
        const safeLimit = Math.max(1, Math.min(this.maxLogs, Number(limit) || 300));
        return this.logs.slice(-safeLimit).map(entry => ({ ...entry }));
    }

    async start() {
        if (this.lifecycle === 'RUNNING') return this.snapshot();
        if (this.startPromise) return this.startPromise;
        this.startPromise = this.#startInternal();
        try {
            return await this.startPromise;
        } finally {
            this.startPromise = null;
        }
    }

    async #startInternal() {
        this.lifecycle = 'STARTING';
        try {
            const output = record => this.#publishLog(record);
            this.bundle = await createApplication({
                baseDir: this.baseDir,
                environment: this.environment,
                output
            });
            await this.bundle.application.initialize();
            await this.bundle.application.start();
            this.lifecycle = 'RUNNING';
            this.startedAt = Date.now();
            this.#publishLog({
                timestamp: VietnamTime.iso(),
                level: 'info',
                scope: 'Desktop',
                message: 'MCbot Desktop backend started.',
                meta: { runtimes: this.bundle.application.listRuntimes().length }
            });
            return this.snapshot();
        } catch (error) {
            this.lifecycle = 'FAILED';
            this.#publishLog({
                timestamp: VietnamTime.iso(),
                level: 'error',
                scope: 'Desktop',
                message: 'MCbot Desktop backend failed to start.',
                meta: { error: plainError(error) }
            });
            try {
                await this.bundle?.application?.destroy?.();
            } catch (cleanupError) {
                this.#publishLog({
                    timestamp: VietnamTime.iso(),
                    level: 'warn',
                    scope: 'Desktop',
                    message: 'Desktop startup cleanup failed.',
                    meta: { error: plainError(cleanupError) }
                }, { persist: false });
            }
            this.bundle = null;
            this.startedAt = null;
            throw error;
        }
    }

    async stop(reason = 'Desktop application shutting down.') {
        if (!this.bundle) {
            this.lifecycle = 'STOPPED';
            return { success: true };
        }
        this.lifecycle = 'STOPPING';
        try {
            await this.bundle.application.stop();
            await this.bundle.application.destroy();
        } finally {
            this.bundle = null;
            this.lifecycle = 'STOPPED';
            this.startedAt = null;
            this.logPolicy?.reset?.();
            this.#publishLog({
                timestamp: VietnamTime.iso(),
                level: 'info',
                scope: 'Desktop',
                message: 'MCbot Desktop backend stopped.',
                meta: { reason }
            });
        }
        return { success: true };
    }

    snapshot() {
        const bundle = this.bundle;
        const profiles = bundle?.fleetControl?.profileSnapshot?.() || {};
        const bots = bundle?.application?.listRuntimes?.().map(runtime => this.#runtimeSnapshot(runtime, profiles[runtime.botId])) || [];
        const memory = process.memoryUsage();
        return {
            lifecycle: this.lifecycle,
            appState: bundle?.application?.getState?.() || null,
            bots,
            fleet: bundle?.fleetControl?.status?.() || null,
            system: {
                startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : null,
                uptimeMs: this.startedAt ? Math.max(0, Date.now() - this.startedAt) : 0,
                memoryMb: Math.round((Number(memory.rss || 0) / 1024 / 1024) * 10) / 10,
                logPersistenceFailure: this.logPersistenceFailure ? Redactor.sanitize(this.logPersistenceFailure) : null,
                logListenerFailure: this.logListenerFailure ? Redactor.sanitize(this.logListenerFailure) : null
            },
            updatedAt: VietnamTime.iso()
        };
    }

    async listProfiles() {
        this.#requireRunning();
        const profiles = await this.bundle.botProfileAdmin.listProfiles();
        return profiles.map(profile => Redactor.sanitize(profile));
    }

    async updateProfile(botId, fields) {
        this.#requireRunning();
        const safeFields = {};
        for (const key of ['displayName', 'username', 'auth', 'version', 'serverProfile', 'skyblockSelection', 'enabled']) {
            if (Object.prototype.hasOwnProperty.call(fields || {}, key)) safeFields[key] = fields[key];
        }
        return Redactor.sanitize(await this.bundle.botProfileAdmin.updateProfile(botId, safeFields));
    }

    async createProfile(fields = {}) {
        this.#requireRunning();
        const safeFields = {};
        for (const key of ['id', 'displayName', 'username', 'auth', 'version', 'serverProfile', 'skyblockSelection']) {
            if (Object.prototype.hasOwnProperty.call(fields || {}, key)) safeFields[key] = fields[key];
        }
        return Redactor.sanitize(await this.bundle.botProfileAdmin.createProfile(safeFields));
    }

    async cloneProfile(botId, newId) {
        this.#requireRunning();
        return Redactor.sanitize(await this.bundle.botProfileAdmin.cloneProfile(botId, newId));
    }

    async deleteProfile(botId) {
        this.#requireRunning();
        return Redactor.sanitize(await this.bundle.botProfileAdmin.deleteProfile(botId));
    }

    async connect(botId) {
        this.#requireRunning();
        return resultPayload(await this.bundle.fleetControl.requestConnection(botId, 'CONNECTED', { source: 'desktop-bot-card' }));
    }

    async disconnect(botId) {
        this.#requireRunning();
        return resultPayload(await this.bundle.fleetControl.requestConnection(botId, 'DISCONNECTED', { source: 'desktop-bot-card' }));
    }

    async startMode(botId, mode) {
        this.#requireRunning();
        return resultPayload(await this.bundle.fleetControl.requestMode(botId, mode, { state: 'ACTIVE', source: 'desktop' }));
    }

    async pauseMode(botId) {
        this.#requireRunning();
        return resultPayload(await this.bundle.fleetControl.requestModeState(botId, 'PAUSED', { source: 'desktop' }));
    }

    async resumeMode(botId) {
        this.#requireRunning();
        return resultPayload(await this.bundle.fleetControl.requestModeState(botId, 'ACTIVE', { source: 'desktop' }));
    }

    async stopMode(botId) {
        this.#requireRunning();
        return resultPayload(await this.bundle.fleetControl.requestMode(botId, null, { source: 'desktop' }));
    }

    async restartMode(botId) {
        this.#requireRunning();
        const intent = this.bundle.fleetControl.intent(botId);
        if (!intent?.desiredMode) throw new Error(`No durable mode intent exists for ${botId}.`);
        return resultPayload(await this.bundle.fleetControl.restartMode(botId, intent.desiredMode, { source: 'desktop' }));
    }


    async reconcileFleet(reason = 'desktop-reconcile') {
        this.#requireRunning();
        return Redactor.sanitize(await this.bundle.fleetControl.reconcileAll({ reason, priority: 'high' }));
    }

    async fleetAction(action) {
        this.#requireRunning();
        const profiles = this.bundle.fleetControl.profileSnapshot();
        const enabledBotIds = Object.keys(profiles).filter(botId => profiles[botId]?.enabled !== false);
        const botIds = ['pause-all', 'resume-all'].includes(action)
            ? enabledBotIds.filter(botId => Boolean(this.bundle.fleetControl.intent?.(botId)?.desiredMode))
            : enabledBotIds;
        if (action === 'emergency-stop') {
            const results = [];
            for (const botId of botIds) {
                const stopped = resultPayload(await this.bundle.fleetControl.requestMode(botId, null, { source: 'desktop-emergency' }));
                const disconnected = resultPayload(await this.bundle.fleetControl.requestConnection(botId, 'DISCONNECTED', { source: 'desktop-emergency' }));
                results.push({ botId, result: { success: stopped.success !== false && disconnected.success !== false, stopped, disconnected } });
            }
            return { action, success: results.every(entry => entry.result.success), results };
        }
        const runners = {
            'connect-all': botId => this.bundle.fleetControl.requestConnection(botId, 'CONNECTED', { source: 'desktop-fleet' }),
            'pause-all': botId => this.bundle.fleetControl.requestModeState(botId, 'PAUSED', { source: 'desktop-fleet' }),
            'resume-all': botId => this.bundle.fleetControl.requestModeState(botId, 'ACTIVE', { source: 'desktop-fleet' }),
            'stop-modes-all': botId => this.bundle.fleetControl.requestMode(botId, null, { source: 'desktop-fleet' }),
            'disconnect-all': botId => this.bundle.fleetControl.requestConnection(botId, 'DISCONNECTED', { source: 'desktop-fleet' }),
            'home-all': async botId => {
                const runtime = this.#runtime(botId);
                if (!runtime.context.has()) return { success: true, status: 'SKIPPED_DISCONNECTED', data: { botId } };
                return runtime.requireService('serverFeatureFacade').island().goHome();
            }
        };
        const run = runners[action];
        if (!run) throw new Error(`Unknown fleet action: ${action}`);
        const settled = await Promise.allSettled(botIds.map(async botId => ({ botId, result: resultPayload(await run(botId)) })));
        const results = settled.map((entry, index) => entry.status === 'fulfilled'
            ? entry.value
            : { botId: botIds[index], result: { success: false, error: plainError(entry.reason) } });
        return {
            action,
            success: results.every(entry => entry.result?.success !== false),
            results
        };
    }

    async sendRegisteredCommand(botId, { commandKey, args = {}, confirm = false, timeoutMs = 5000 } = {}) {
        const runtime = this.#runtime(botId);
        const commands = this.bundle.configuration.registry.require('commands');
        if (typeof commandKey === 'string' && commandKey.startsWith('sky:')) {
            const [, skyId, ...idParts] = commandKey.split(':');
            const commandId = idParts.join(':');
            if (!skyId || !commandId) throw new Error(`Invalid scoped Sky command key: ${commandKey}`);
            return this.sendSkyCommand(botId, { skyId, commandId, args });
        }
        if (!commandKey || commandKey === 'login' || !Object.prototype.hasOwnProperty.call(commands, commandKey)) {
            throw new Error(`Unknown or restricted command key: ${commandKey || '(empty)'}`);
        }
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new TypeError('Command args must be an object.');
        return resultPayload(await runtime.requireService('commandService').send(commandKey, {
            args,
            confirm: Boolean(confirm),
            timeoutMs: Math.max(500, Math.min(30000, Number(timeoutMs) || 5000)),
            expectedGeneration: runtime.context.getGeneration()
        }));
    }

    skyCommandsConfig() {
        this.#requireRunning();
        const value = this.bundle.configuration.registry.require('skyCommands');
        const selections = Object.keys(this.bundle.configuration.registry.require('skyblock')?.selections || {});
        return Redactor.sanitize({ value, selections });
    }

    upsertSkyCommand(args = {}) { return this.#configMutation(() => this.#upsertSkyCommand(args)); }

    async #upsertSkyCommand({ skyId, commandId, previousCommandId = null, command, label = '', description = '', enabled = true } = {}) {
        this.#requireRunning();
        const normalizedSky = String(skyId || '').trim();
        const normalizedId = String(commandId || '').trim();
        if (!normalizedSky || !normalizedId) throw new Error('Sky và ID lệnh là bắt buộc.');
        const current = this.bundle.configuration.registry.require('skyCommands');
        const next = JSON.parse(JSON.stringify(current));
        next[normalizedSky] ||= {};
        const previousId = String(previousCommandId || '').trim();
        if (previousId && previousId !== normalizedId) delete next[normalizedSky][previousId];
        next[normalizedSky][normalizedId] = {
            command: String(command || '').trim(),
            label: String(label || normalizedId).trim() || normalizedId,
            description: String(description || '').trim(),
            enabled: enabled !== false
        };
        return this.#saveConfigGroup('skyCommands', next);
    }

    deleteSkyCommand(skyId, commandId) { return this.#configMutation(() => this.#deleteSkyCommand(skyId, commandId)); }

    async #deleteSkyCommand(skyId, commandId) {
        this.#requireRunning();
        const normalizedSky = String(skyId || '').trim();
        const normalizedId = String(commandId || '').trim();
        const current = this.bundle.configuration.registry.require('skyCommands');
        const next = JSON.parse(JSON.stringify(current));
        if (!next?.[normalizedSky] || !Object.prototype.hasOwnProperty.call(next[normalizedSky], normalizedId)) {
            throw new Error(`Lệnh Sky không tồn tại: ${normalizedSky}.${normalizedId}`);
        }
        delete next[normalizedSky][normalizedId];
        return this.#saveConfigGroup('skyCommands', next);
    }

    async sendSkyCommand(botId, { skyId = null, commandId, args = {} } = {}) {
        const runtime = this.#runtime(botId);
        return resultPayload(await runtime.requireService('skyCommandService').send(commandId, {
            skyId,
            args,
            expectedGeneration: runtime.context.getGeneration()
        }));
    }

    async backupConfig() {
        const source = path.join(this.baseDir, 'config');
        const timestamp = VietnamTime.iso().replace(/[:.]/g, '-');
        const destination = path.join(this.baseDir, 'data', 'backups', `config-${timestamp}`);
        await fsp.mkdir(path.dirname(destination), { recursive: true });
        await fsp.cp(source, destination, { recursive: true, errorOnExist: true });
        this.#publishLog({
            timestamp: VietnamTime.iso(),
            level: 'info',
            scope: 'Desktop',
            message: 'Configuration backup created.',
            meta: { destination }
        });
        return { path: destination, createdAt: VietnamTime.iso() };
    }

    async exportSupportBundle() {
        const directory = path.join(this.baseDir, 'data', 'support');
        await fsp.mkdir(directory, { recursive: true });
        const createdAt = VietnamTime.iso();
        const filePath = path.join(directory, `support-${createdAt.replace(/[:.]/g, '-')}.json`);
        const diagnosticNames = this.diagnostics({ limit: 20 }).map(entry => entry.name);
        const diagnostics = [];
        for (const name of diagnosticNames) {
            try { diagnostics.push({ name, data: this.readDiagnostic(name) }); } catch (error) {
                diagnostics.push({ name, error: plainError(error) });
            }
        }
        const b5Replays = this.bundle?.application?.listRuntimes?.().map(runtime => ({
            botId: runtime.botId,
            fixture: runtime.getService?.('b5TraceRecorder')?.latestReplayFixture?.() || null
        })).filter(entry => entry.fixture) || [];
        const payload = Redactor.sanitize({
            createdAt,
            snapshot: this.snapshot(),
            profiles: this.bundle ? await this.listProfiles() : [],
            logs: this.logSnapshot({ limit: 500 }),
            diagnostics,
            b5Replays
        });
        await fsp.writeFile(filePath, `${JSON.stringify(payload, null, 2)}
`, 'utf8');
        return { path: filePath, createdAt };
    }

    async goHome(botId) {
        const runtime = this.#runtime(botId);
        const island = runtime.requireService('serverFeatureFacade').island();
        return resultPayload(await island.goHome());
    }


    async collectorConfig(botId) {
        this.#requireRunning();
        const editor = new CollectorB5ConfigEditor({
            baseDir: this.baseDir,
            configuration: this.bundle.configuration,
            botRegistry: this.bundle.shared.botRegistry,
            botId,
            logger: this.bundle.shared.loggerFactory.create('DesktopCollectorConfig'),
            mutationCoordinator: this.bundle.shared.configMutations
        });
        return Redactor.sanitize(await editor.read());
    }

    async updateCollectorConfig(botId, fields = {}) {
        this.#requireRunning();
        const editor = new CollectorB5ConfigEditor({
            baseDir: this.baseDir,
            configuration: this.bundle.configuration,
            botRegistry: this.bundle.shared.botRegistry,
            botId,
            logger: this.bundle.shared.loggerFactory.create('DesktopCollectorConfig'),
            mutationCoordinator: this.bundle.shared.configMutations
        });
        return Redactor.sanitize(await editor.update(fields));
    }

    async fishingConfig(botId) {
        this.#requireRunning();
        const editor = new FishingBotConfigEditor({
            baseDir: this.baseDir,
            configuration: this.bundle.configuration,
            botRegistry: this.bundle.shared.botRegistry,
            logger: this.bundle.shared.loggerFactory.create('DesktopFishingConfig'),
            mutationCoordinator: this.bundle.shared.configMutations
        });
        return Redactor.sanitize(await editor.read(botId));
    }

    async updateFishingArea(botId, fields = {}) {
        this.#requireRunning();
        const editor = new FishingBotConfigEditor({
            baseDir: this.baseDir,
            configuration: this.bundle.configuration,
            botRegistry: this.bundle.shared.botRegistry,
            logger: this.bundle.shared.loggerFactory.create('DesktopFishingConfig'),
            mutationCoordinator: this.bundle.shared.configMutations
        });
        return Redactor.sanitize(await editor.setAreaPosition({ botId, ...fields }));
    }



    configGroups() {
        this.#requireRunning();
        const registry = this.bundle.configuration.registry;
        return ConfigSpecs.map(spec => ({
            key: spec.key,
            file: spec.file,
            schema: spec.schema,
            value: registry.get(spec.key)
        }));
    }

    configGroup(key) {
        this.#requireRunning();
        const spec = ConfigSpecs.find(entry => entry.key === key);
        if (!spec) throw new Error(`Nhóm cấu hình không tồn tại: ${key}`);
        return { key: spec.key, file: spec.file, schema: spec.schema, value: this.bundle.configuration.registry.require(key) };
    }

    saveConfigGroup(key, value) { return this.#configMutation(() => this.#saveConfigGroup(key, value)); }

    async #saveConfigGroup(key, value) {
        this.#requireRunning();
        const spec = ConfigSpecs.find(entry => entry.key === key);
        if (!spec) throw new Error(`Nhóm cấu hình không tồn tại: ${key}`);
        this.bundle.configuration.validator.assertValid(spec.schema, value);
        const profiles = Object.values(this.bundle.fleetControl.profileSnapshot() || {});
        const candidate = { ...this.bundle.configuration.registry.snapshot(), [key]: value };
        this.bundle.configuration.crossValidator.assertValid(candidate, { botProfiles: profiles, requireComplete: true });
        const backup = await this.#writeConfigAtomic(spec.file, value, key);
        const result = await this.bundle.configuration.service.reload(key, spec.file, spec.schema, { botProfiles: profiles });
        if (!result.success) throw result.error || new Error(result.message || `Không thể reload cấu hình ${key}.`);
        let applied = false;
        if (key === 'skyblock') {
            for (const runtime of this.bundle.application.listRuntimes()) { const gateway = runtime.getService('skyblockAutoJoin'); gateway?.reconfigure?.({ ...(value.modeJoin || {}), selection: gateway?.status?.().defaultTarget || value.defaultSelection }); }
            applied = true;
        } else if (key === 'skyCommands') {
            for (const runtime of this.bundle.application.listRuntimes()) runtime.getService('skyCommandService')?.reconfigure?.(value);
            applied = true;
        } else if (key === 'b5CraftMode') {
            for (const runtime of this.bundle.application.listRuntimes()) {
                const mode = runtime.getService('b5CraftMode');
                mode?.reconfigure?.(value);
                if (value.enabled === false && mode?.status?.().enabled) {
                    await mode.disable('Chế B5 thuần đã bị tắt trong cấu hình.');
                }
            }
            applied = true;
        }
        return Redactor.sanitize({ key, file: spec.file, backup, appliedLive: applied, restartRequired: !applied, value });
    }

    b5CraftConfig() { return this.configGroup('b5CraftMode'); }

    b5RulesConfig() { return this.configGroup('b5'); }

    updateB5RulesConfig(fields = {}) { return this.#configMutation(() => this.#updateB5RulesConfig(fields)); }

    async #updateB5RulesConfig(fields = {}) {
        this.#requireRunning();
        const current = this.bundle.configuration.registry.require('b5');
        const next = {
            ...current,
            ...pick(fields, ['inventorySafetyEmptySlots','b3AllMinEmptySlots']),
            quantityOptimization: { ...current.quantityOptimization, ...(fields.quantityOptimization || {}) },
            personalVaultBackpressure: { ...current.personalVaultBackpressure, ...(fields.personalVaultBackpressure || {}) }
        };
        return this.#saveConfigGroup('b5', next);
    }


    updateB5CraftConfig(fields = {}) { return this.#configMutation(() => this.#updateB5CraftConfig(fields)); }

    async #updateB5CraftConfig(fields = {}) {
        const current = this.bundle.configuration.registry.require('b5CraftMode');
        const next = {
            ...current,
            ...pick(fields, ['enabled','teleportHomeOnEnable','autoResumeOnReconnect','pollIntervalMs','disconnectedPollMs','errorRetryMs','errorRetryMaxMs','craftLoopDelayMs','postB5CooldownMs']),
            stability: {
                ...(current.stability || {}),
                ...(fields.stability || {})
            },
            reconciliation: {
                ...(current.reconciliation || {}),
                ...(fields.reconciliation || {})
            }
        };
        return this.#saveConfigGroup('b5CraftMode', next);
    }

    storageProtectionConfig() {
        this.#requireRunning();
        const storage = this.bundle.configuration.registry.require('storage');
        const collector = this.bundle.configuration.registry.require('collectorB5Mode');
        return {
            sell: storage.sell || {},
            collector: {
                b1Decompression: collector.b1Decompression || { maxUsageRatio: 0.8, requireKnownCapacity: true }
            }
        };
    }

    updateStorageProtectionConfig(fields = {}) { return this.#configMutation(() => this.#updateStorageProtectionConfig(fields)); }

    async #updateStorageProtectionConfig(fields = {}) {
        this.#requireRunning();
        const storage = this.bundle.configuration.registry.require('storage');
        const collector = this.bundle.configuration.registry.require('collectorB5Mode');
        const requestedSell = fields.sell || {};
        const sell = {
            ...(storage.sell || {}),
            ...(Object.prototype.hasOwnProperty.call(requestedSell, 'blockOnly') ? { blockOnly: requestedSell.blockOnly } : {}),
            // B5 protection reserve and mandatory-sale boundary are business
            // invariants. Desktop cannot disable selling or tune reserve.
            reserveCoverage: 1.5,
            allowSingle: false
        };
        const nextStorage = { ...storage, sell };
        const nextCollector = {
            ...collector,
            b1Decompression: { ...(collector.b1Decompression || {}), ...(fields.collector?.b1Decompression || {}) }
        };
        const profiles = Object.values(this.bundle.fleetControl.profileSnapshot() || {});
        this.bundle.configuration.validator.assertValid('storage', nextStorage);
        this.bundle.configuration.validator.assertValid('collectorB5Mode', nextCollector);
        const candidate = { ...this.bundle.configuration.registry.snapshot(), storage: nextStorage, collectorB5Mode: nextCollector };
        this.bundle.configuration.crossValidator.assertValid(candidate, { botProfiles: profiles, requireComplete: true });
        const backups = [
            await this.#writeConfigAtomic('config/storage/kho.json', nextStorage, 'storage'),
            await this.#writeConfigAtomic('config/modes/collector-b5.json', nextCollector, 'collectorB5Mode')
        ];
        const first = await this.bundle.configuration.service.reload('storage', 'config/storage/kho.json', 'storage', { botProfiles: profiles });
        if (!first.success) throw first.error || new Error(first.message);
        const second = await this.bundle.configuration.service.reload('collectorB5Mode', 'config/modes/collector-b5.json', 'collectorB5Mode', { botProfiles: profiles });
        if (!second.success) throw second.error || new Error(second.message);
        const live = [];
        const conversion = this.bundle.configuration.registry.require('mineralConversions');
        for (const runtime of this.bundle.application.listRuntimes()) {
            runtime.getService('b1Materials')?.reconfigure?.({ conversionConfig: conversion, storageConfig: nextStorage });
            runtime.getService('collectorB5Mode')?.reconfigure?.(nextCollector);
            live.push(runtime.botId);
        }
        return Redactor.sanitize({ sell, collector: nextCollector, backups, appliedLive: true, restartRequired: false, botsApplied: live });
    }

    // Kept as a compatibility API for older Desktop preload clients. There is
    // no Auto Join toggle anymore; these methods expose only gateway timing.
    skyAutoJoinConfig() {
        const group = this.configGroup('skyblock');
        return { ...group, value: group.value.modeJoin || {}, selections: Object.keys(group.value.selections || {}) };
    }

    updateSkyAutoJoinConfig(fields = {}) { return this.#configMutation(() => this.#updateSkyAutoJoinConfig(fields)); }

    async #updateSkyAutoJoinConfig(fields = {}) {
        this.#requireRunning();
        const current = this.bundle.configuration.registry.require('skyblock');
        const allowed = pick(fields, ['delayMs','spawnFallbackDelayMs','retryDelayMs','rejoinDelayMs','recoveryPollMs','waitForResourcePack']);
        const next = { ...current, modeJoin: { ...(current.modeJoin || {}), ...allowed } };
        return this.#saveConfigGroup('skyblock', next);
    }

    customModeModules() {
        return new WorkflowDefinitionValidator().moduleCatalog();
    }

    customModes() {
        const store = new CustomModeStore({ baseDir: this.baseDir });
        return store.list();
    }

    async saveCustomMode(definition) {
        const store = new CustomModeStore({ baseDir: this.baseDir, mutationCoordinator: this.bundle?.shared?.configMutations });
        return Redactor.sanitize(await store.save(definition));
    }

    async deleteCustomMode(modeId) {
        const store = new CustomModeStore({ baseDir: this.baseDir, mutationCoordinator: this.bundle?.shared?.configMutations });
        return Redactor.sanitize(await store.remove(modeId));
    }

    async inspectGui(botId, { commandKey, slots = [], timeoutMs = 7000 } = {}) {
        const runtime = this.#runtime(botId);
        const commands = this.bundle.configuration.registry.require('commands');
        if (!Object.prototype.hasOwnProperty.call(commands, commandKey)) throw new Error(`Unknown command key: ${commandKey}`);
        const normalizedSlots = Array.isArray(slots) ? slots.map(Number).filter(Number.isInteger) : [];
        const snapshot = await runtime.requireService('guiInspectionService').capture({
            commandKey,
            commandDisplay: commands[commandKey],
            slots: normalizedSlots,
            timeoutMs: Number(timeoutMs) || 7000
        });
        return Redactor.sanitize(snapshot);
    }

    commandOptions() {
        this.#requireRunning();
        const commands = this.bundle.configuration.registry.require('commands');
        const system = Object.entries(commands)
            .filter(([key]) => key !== 'login')
            .map(([key, command]) => ({ key, command, scope: 'system' }));
        const skyCommands = this.bundle.configuration.registry.require('skyCommands');
        const scoped = [];
        for (const [skyId, entries] of Object.entries(skyCommands || {})) {
            for (const [commandId, definition] of Object.entries(entries || {})) {
                if (definition?.enabled === false) continue;
                scoped.push({
                    key: `sky:${skyId}:${commandId}`,
                    command: definition.command,
                    label: definition.label || commandId,
                    scope: 'sky',
                    skyId,
                    commandId
                });
            }
        }
        return [...system, ...scoped];
    }

    diagnostics({ limit = 40 } = {}) {
        const directory = path.resolve(this.baseDir, this.bundle?.configuration?.registry?.require('app')?.runtimeFailures?.directory || 'data/runtime/errors');
        if (!fs.existsSync(directory)) return [];
        return fs.readdirSync(directory, { withFileTypes: true })
            .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
            .map(entry => {
                const full = path.join(directory, entry.name);
                const stat = fs.statSync(full);
                return { name: entry.name, modifiedAt: stat.mtime.toISOString(), size: stat.size };
            })
            .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
            .slice(0, Math.max(1, Math.min(200, Number(limit) || 40)));
    }

    readDiagnostic(name) {
        const safeName = path.basename(String(name || ''));
        if (!safeName.endsWith('.json')) throw new Error('Invalid diagnostic file name.');
        const directory = path.resolve(this.baseDir, this.bundle?.configuration?.registry?.require('app')?.runtimeFailures?.directory || 'data/runtime/errors');
        const full = path.join(directory, safeName);
        const text = fs.readFileSync(full, 'utf8');
        return Redactor.sanitize(JSON.parse(text));
    }


    #configMutation(work) {
        const coordinator = this.bundle?.shared?.configMutations;
        return coordinator?.run ? coordinator.run('config-set', work) : work();
    }

    async #writeConfigAtomic(relativeFile, value, key = 'config') {
        const target = path.resolve(this.baseDir, relativeFile);
        const backupDirectory = path.join(this.baseDir, 'data', 'backups', 'config-editor');
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.mkdir(backupDirectory, { recursive: true });
        const stamp = VietnamTime.iso().replace(/[:.]/g, '-');
        let backup = null;
        try {
            const previous = await fsp.readFile(target, 'utf8');
            backup = path.join(backupDirectory, `${String(key).replace(/[^a-z0-9_-]/gi, '_')}-${stamp}.json`);
            await fsp.writeFile(backup, previous, 'utf8');
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
        const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
        await fsp.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await fsp.rename(temp, target);
        return backup;
    }

    #runtime(botId) {
        this.#requireRunning();
        return this.bundle.application.getRuntime(botId);
    }

    #requireRunning() {
        if (!this.bundle || this.lifecycle !== 'RUNNING') throw new Error('MCbot backend is not running.');
    }

    #runtimeSnapshot(runtime, profile = null) {
        const state = runtime.getState();
        const client = runtime.context.get();
        const entity = client?.entity || null;
        const position = entity?.position || null;
        const held = client?.heldItem || null;
        const inventory = client?.inventory;
        const items = inventory?.items?.() || [];
        const modeRegistrySnapshot = runtime.getService('modeRegistry')?.status?.() || { modes: [] };
        const modesById = Object.fromEntries((modeRegistrySnapshot.modes || []).map(entry => [entry.definition.id, {
            ...entry.status,
            definition: entry.definition,
            readiness: entry.readiness
        }]));
        const collector = modesById['collector-b5'] || runtime.getService('collectorB5Mode')?.status?.() || null;
        const b5Craft = modesById['b5-craft'] || runtime.getService('b5CraftMode')?.status?.() || null;
        const fishing = modesById.fishing || runtime.getService('fishingMode')?.status?.() || null;
        const skyAutoJoin = runtime.getService('skyblockAutoJoin')?.status?.() || null;
        const skyCommands = runtime.getService('skyCommandService')?.status?.() || null;
        const storageProtection = runtime.getService('b1Materials')?.status?.() || null;
        const gui = runtime.getService('guiManager')?.describeCurrent?.() || null;
        const platform = runtime.getService('runtimePlatform')?.snapshot?.() || null;
        const owner = runtime.getService('modeCoordinator')?.owner?.() || null;
        const operation = runtime.getService('operationManager')?.snapshot?.() || null;
        return Redactor.sanitize({
            botId: runtime.botId,
            profile: profile ? {
                id: profile.id,
                displayName: profile.displayName,
                username: profile.username,
                enabled: profile.enabled,
                auth: profile.auth,
                version: profile.version,
                serverProfile: profile.serverProfile
            } : null,
            state,
            intent: this.bundle?.fleetControl?.intent?.(runtime.botId) || null,
            connectionGeneration: runtime.context.getGeneration(),
            player: client ? {
                username: client.username || profile?.username || null,
                health: Number.isFinite(client.health) ? client.health : null,
                food: Number.isFinite(client.food) ? client.food : null,
                ping: Number.isFinite(client.player?.ping) ? client.player.ping : null,
                dimension: client.game?.dimension || null,
                position: position ? { x: position.x, y: position.y, z: position.z } : null,
                yaw: Number.isFinite(entity?.yaw) ? entity.yaw : null,
                pitch: Number.isFinite(entity?.pitch) ? entity.pitch : null,
                heldItem: held ? { name: held.name, count: held.count, displayName: held.displayName || null } : null,
                offhandItem: client.inventory?.slots?.[45] ? { name: client.inventory.slots[45].name, count: client.inventory.slots[45].count, displayName: client.inventory.slots[45].displayName || null } : null,
                inventory: {
                    slotsUsed: items.length,
                    slotsFreeApprox: Math.max(0, 36 - items.length),
                    itemCount: items.reduce((sum, item) => sum + Number(item?.count || 0), 0)
                }
            } : null,
            modeOwner: owner,
            modes: {
                available: (modeRegistrySnapshot.modes || []).map(entry => ({ definition: entry.definition, readiness: entry.readiness })),
                byId: modesById,
                collectorB5: collector,
                b5Craft,
                fishing
            },
            skyAutoJoin,
            skyCommands,
            storageProtection,
            gui,
            platform,
            operation
        });
    }


    #persistLog(record) {
        try {
            const directory = path.join(this.baseDir, 'data', 'logs');
            fs.mkdirSync(directory, { recursive: true });
            const day = String(record.timestamp || VietnamTime.iso()).slice(0, 10);
            fs.appendFile(path.join(directory, `mcbot-desktop-${day}.jsonl`), `${JSON.stringify(record)}\n`, error => {
                if (error) this.#recordLogPersistenceFailure(error);
            });
        } catch (error) {
            this.#recordLogPersistenceFailure(error);
        }
    }

    #recordLogPersistenceFailure(error) {
        this.logPersistenceFailure = {
            at: VietnamTime.iso(),
            error: plainError(error)
        };
    }

    #publishLog(record, { persist = true } = {}) {
        const sanitized = Redactor.sanitize({
            timestamp: record?.timestamp || VietnamTime.iso(),
            level: record?.level || 'info',
            scope: record?.scope || 'Application',
            message: record?.message || '',
            meta: record?.meta || null
        });

        // The JSONL file remains the detailed forensic source. The desktop view
        // intentionally receives only operator-relevant events, with repeated
        // messages folded so long B5/reconnect loops stay readable.
        if (persist) this.#persistLog(sanitized);
        const visible = this.logPolicy?.project?.(sanitized) || null;
        if (!visible) return;

        this.logs.push(visible);
        if (this.logs.length > this.maxLogs) this.logs.splice(0, this.logs.length - this.maxLogs);
        for (const listener of [...this.logListeners]) {
            try {
                listener(visible);
            } catch (error) {
                this.logListenerFailure = {
                    at: VietnamTime.iso(),
                    error: plainError(error)
                };
            }
        }
    }
}

module.exports = DesktopController;
