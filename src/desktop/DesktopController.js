'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Redactor = require('../shared/security/Redactor');
const ConfigSpecs = require('../configuration/ConfigSpecs');
const DesktopLogPolicy = require('./DesktopLogPolicy');
const VietnamTime = require('../shared/time/VietnamTime');
const RuntimeFailureArtifactRepository = require('../diagnostics/runtime/RuntimeFailureArtifactRepository');
const SupportBundleBuilder = require('../diagnostics/support/SupportBundleBuilder');
const BootFailureContract = require('./BootFailureContract');
const IncidentIndexStore = require('./incidents/IncidentIndexStore');
const OperatorHealthService = require('./health/OperatorHealthService');
const B5OperatorProjection = require('./b5/B5OperatorProjection');
const ConfigurationWorkspaceService = require('./configuration/ConfigurationWorkspaceService');
const BackupCatalogService = require('./backup/BackupCatalogService');
const OperatorSnapshotProjector = require('./projection/OperatorSnapshotProjector');
const CustomModeUseCases = require('./use-cases/CustomModeUseCases');
const BotProfileUseCases = require('./use-cases/BotProfileUseCases');
const ModeConfigurationUseCases = require('./use-cases/ModeConfigurationUseCases');
const FleetControlUseCases = require('./use-cases/FleetControlUseCases');
const { plainError, resultPayload } = require('./contracts/DesktopResult');

const SUPPORT_PREVIEW_TTL_MS = 60000;
const SUPPORT_DIAGNOSTIC_MAX_BYTES = 128 * 1024;
const BOT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/;

function pick(source, keys) {
    const output = {};
    for (const key of keys) if (Object.prototype.hasOwnProperty.call(source || {}, key)) output[key] = source[key];
    return output;
}

function botIdFromLogRecord(record) {
    const explicit = String(record?.meta?.botId || '').trim();
    if (BOT_ID_PATTERN.test(explicit)) return explicit;
    const match = /^BotRuntime:([a-z0-9][a-z0-9_-]{1,31})$/.exec(String(record?.scope || '').trim());
    return match ? match[1] : null;
}

class DesktopController {
    constructor({ baseDir = process.cwd(), environment = process.env, maxLogs = 1200, logPolicy = null, applicationFactory = null, incidentIndexStore = null, backupCatalogService = null, appVersion = 'unknown' } = {}) {
        this.baseDir = path.resolve(baseDir);
        this.environment = {};
        this.maxLogs = Math.max(100, Number(maxLogs) || 1200);
        this.logPolicy = logPolicy || new DesktopLogPolicy({ repeatWindowMs: 15000 });
        this.applicationFactory = applicationFactory;
        this.bundle = null;
        this.lifecycle = 'STOPPED';
        this.configureEnvironment(environment);
        this.logs = [];
        this.logListeners = new Set();
        this.startPromise = null;
        this.startedAt = null;
        this.logPersistenceFailure = null;
        this.logListenerFailure = null;
        this.bootFailure = null;
        this.bootStage = null;
        this.runtimeFailureArtifactRepository = null;
        this.supportPreviewCache = null;
        this.incidentIndexStore = incidentIndexStore || new IncidentIndexStore({ filePath: path.join(this.baseDir, 'data', 'runtime', 'incidents', 'index.json') });
        this.backupCatalogService = backupCatalogService || new BackupCatalogService({ baseDir: this.baseDir, appVersion });
        this.operatorHealthService = new OperatorHealthService({ snapshotProvider: () => this.snapshot() });
        this.operatorSnapshotProjector = new OperatorSnapshotProjector();
        this.configurationWorkspaceService = new ConfigurationWorkspaceService({
            loadGroup: key => this.configGroup(key),
            saveGroup: (key, value) => this.saveConfigGroup(key, value),
            validateGroup: (key, value) => this.#validateConfigWorkspaceGroup(key, value)
        });
        this.incidentActionCache = new Map();
        this.customModeUseCases = new CustomModeUseCases({
            baseDir:this.baseDir,
            mutationCoordinator:() => this.bundle?.shared?.configMutations || null,
            modeCatalog:() => this.bundle?.shared?.modeCatalog || null
        });
        this.botProfileUseCases = new BotProfileUseCases({
            bundleProvider: () => this.bundle,
            requireRunning: () => this.#requireRunning()
        });
        this.modeConfigurationUseCases = new ModeConfigurationUseCases({
            baseDir: this.baseDir,
            bundleProvider: () => this.bundle,
            requireRunning: () => this.#requireRunning()
        });
        this.fleetControlUseCases = new FleetControlUseCases({
            bundleProvider: () => this.bundle,
            requireRunning: () => this.#requireRunning()
        });
    }

    configureEnvironment(environment = process.env) {
        if (['STARTING', 'RUNNING', 'STOPPING'].includes(this.lifecycle)) {
            throw Object.assign(new Error('Desktop environment can only be replaced while the backend is stopped.'), {
                code: 'DESKTOP_ENVIRONMENT_REPLACE_UNSAFE'
            });
        }
        this.environment = Object.freeze({ ...(environment || {}), MCBOT_DESKTOP: '1' });
        return Object.freeze({ updated: true, desktopMarker: true });
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
        this.bootStage = 'APPLICATION_CREATE';
        try {
            const output = record => this.#publishLog(record);
            const createApplication = this.applicationFactory || require('../bootstrap/createApplication');
            this.bundle = await createApplication({
                baseDir: this.baseDir,
                environment: this.environment,
                output
            });
            this.bootStage = 'RUNTIME_START';
            await this.bundle.application.initialize();
            await this.bundle.application.start();
            this.lifecycle = 'RUNNING';
            this.bootFailure = null;
            this.bootStage = null;
            this.runtimeFailureArtifactRepository = null;
            this.supportPreviewCache = null;
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
            this.bootFailure = BootFailureContract.create(error, { stage: this.bootStage, baseDir: this.baseDir });
            this.bootStage = null;
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
            this.runtimeFailureArtifactRepository = null;
            this.supportPreviewCache = null;
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
            bootFailure: this.bootFailure,
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

    operatorHealth(options = {}) {
        return this.operatorHealthService.sample(options);
    }

    operatorSnapshot() {
        return this.operatorSnapshotProjector.project(this.snapshot(), { incidents: this.incidentIndexStore.snapshot({ states: ['OPEN','RECOVERING','NEEDS_ACTION'], limit: 20 }) });
    }

    botOperatorDetail(botId, expectedRevision = null) {
        const projection = this.operatorSnapshot();
        if (expectedRevision !== null && Number(expectedRevision) > Number(projection.revision)) throw Object.assign(new Error('Requested operator snapshot revision is not available.'), { code: 'DESKTOP_SNAPSHOT_REVISION_INVALID' });
        const bot = this.snapshot().bots.find(item => item.botId === botId);
        if (!bot) throw Object.assign(new Error(`Bot does not exist: ${botId}`), { code: 'DESKTOP_BOT_NOT_FOUND' });
        return { contract: 'operator-bot-detail-v1', snapshotRevision: projection.revision, snapshotDigest: projection.digest, bot };
    }

    b5OperatorJourney(botId = null) {
        const bots = this.snapshot().bots || [];
        const selected = botId ? bots.filter(bot => bot.botId === botId) : bots;
        if (botId && selected.length === 0) throw Object.assign(new Error(`Bot does not exist: ${botId}`), { code: 'DESKTOP_BOT_NOT_FOUND' });
        return { contract: B5OperatorProjection.CONTRACT, items: selected.map(bot => B5OperatorProjection.projectBot(bot)), projectedAt: VietnamTime.iso() };
    }

    async incidents({ limit = 100, states = null, botId = null } = {}) {
        await this.incidentIndexStore.load();
        const artifacts = this.#runtimeFailureArtifacts().list({ limit: Math.min(100, Number(limit) || 100), botId, hydrateMetadata: true });
        for (const artifact of artifacts.items || []) {
            try {
                const record = this.#runtimeFailureArtifacts().read(artifact.id);
                await this.incidentIndexStore.ingest(record, { artifactId: artifact.id });
            } catch (error) {
                this.#publishLog({ timestamp: VietnamTime.iso(), level: 'warn', scope: 'IncidentCenter', message: 'Không thể lập chỉ mục một runtime failure artifact.', meta: { artifactId: artifact.id, code: error?.code || null } }, { persist: false });
            }
        }
        return { contract: IncidentIndexStore.CONTRACT, items: this.incidentIndexStore.snapshot({ limit, states, botId }), warnings: artifacts.warnings || [] };
    }

    async incident(id) {
        await this.incidents({ limit: 100 });
        const incident = this.incidentIndexStore.find(id);
        if (!incident) throw Object.assign(new Error('Incident does not exist.'), { code: 'DESKTOP_INCIDENT_NOT_FOUND' });
        return incident;
    }

    async transitionIncident(id, state, options = {}) {
        return this.incidentIndexStore.transition(id, state, options);
    }

    async executeIncidentAction(id, action, request = {}) {
        const incident = await this.incident(id);
        const normalizedAction = String(action || '');
        if (!incident.allowedActions.includes(normalizedAction)) throw Object.assign(new Error('Action is not allowed for this incident.'), { code: 'DESKTOP_INCIDENT_ACTION_NOT_ALLOWED' });
        const actionContract = require('../shared/contracts/OperatorErrorContract').ACTION_CATALOG[normalizedAction];
        if (!actionContract) throw Object.assign(new Error('Unknown incident action.'), { code: 'DESKTOP_INCIDENT_ACTION_UNKNOWN' });
        if (actionContract.confirmation === 'DESTRUCTIVE' && request.confirmed !== true) throw Object.assign(new Error('Incident action requires explicit confirmation.'), { code: 'DESKTOP_INCIDENT_CONFIRMATION_REQUIRED' });
        if (actionContract.generationGuard && Number(request.expectedGeneration) !== Number(incident.generation)) throw Object.assign(new Error('Incident action connection generation is stale.'), { code: 'DESKTOP_INCIDENT_STALE_GENERATION' });
        const idempotencyKey = String(request.idempotencyKey || '').trim();
        if (actionContract.idempotencyRequired && !/^[a-z0-9][a-z0-9:._-]{0,127}$/i.test(idempotencyKey)) throw Object.assign(new Error('Incident action requires a valid idempotency key.'), { code: 'DESKTOP_INCIDENT_IDEMPOTENCY_REQUIRED' });
        const fingerprint = JSON.stringify({ id, action: normalizedAction, generation: request.expectedGeneration ?? null });
        this.#trimIncidentActionCache();
        const cached = idempotencyKey && this.incidentActionCache.get(idempotencyKey);
        if (cached) {
            if (cached.fingerprint !== fingerprint) throw Object.assign(new Error('Incident idempotency key was reused for another action.'), { code: 'DESKTOP_INCIDENT_IDEMPOTENCY_CONFLICT' });
            return cached.result;
        }
        let result;
        if (normalizedAction === 'inspect-diagnostic') {
            const artifactId = incident.evidenceRefs.at(-1);
            result = { artifactId, diagnostic: artifactId ? this.readDiagnostic(artifactId) : null };
        } else if (normalizedAction === 'export-support') {
            result = await this.supportBundlePreview();
        } else if (normalizedAction === 'retry-storage-protection') {
            const runtime = this.#runtime(incident.botId);
            const mode = runtime.getService?.('b5CraftMode')?.status?.();
            const episode = mode?.details?.protectionEpisode;
            if (!episode) throw Object.assign(new Error('Current B5 storage-protection episode no longer exists.'), { code: 'B5_RETRY_STALE_EPISODE' });
            result = await this.retryB5StorageProtection(incident.botId, {
                expectedGeneration: request.expectedGeneration,
                episodeId: episode.episodeId,
                incidentId: episode.correlationId,
                idempotencyKey
            });
        } else if (normalizedAction === 'reconnect-bot') {
            const runtime = this.#runtime(incident.botId);
            if (runtime.context.getGeneration() !== Number(request.expectedGeneration)) throw Object.assign(new Error('Connection generation changed before reconnect action.'), { code: 'DESKTOP_INCIDENT_STALE_GENERATION' });
            result = await this.connect(incident.botId);
        } else if (normalizedAction === 'edit-config') {
            result = { navigateTo: 'settings', readOnlyAction: true };
        } else {
            throw Object.assign(new Error('Incident action has no Desktop executor.'), { code: 'DESKTOP_INCIDENT_ACTION_UNIMPLEMENTED' });
        }
        await this.incidentIndexStore.transition(id, normalizedAction === 'inspect-diagnostic' || normalizedAction === 'export-support' || normalizedAction === 'edit-config' ? incident.state : 'RECOVERING', { reason: normalizedAction, actionResult: result, expectedGeneration: actionContract.generationGuard ? request.expectedGeneration : undefined });
        if (idempotencyKey) this.incidentActionCache.set(idempotencyKey, { fingerprint, result, expiresAt: Date.now() + 120000 });
        return result;
    }

    openConfigWorkspace(key) { return this.configurationWorkspaceService.open(key); }
    previewConfigWorkspace(sessionId, value) { return this.configurationWorkspaceService.preview(sessionId, value); }
    saveConfigWorkspace(sessionId, value, options) { return this.configurationWorkspaceService.save(sessionId, value, options); }
    undoConfigWorkspace(sessionId) { return this.configurationWorkspaceService.undo(sessionId); }
    closeConfigWorkspace(sessionId) { return { closed: this.configurationWorkspaceService.close(sessionId) }; }

    backupCatalog(options) { return this.backupCatalogService.list(options); }
    previewConfigRestore(id) { return this.backupCatalogService.previewRestore(id); }

    async restoreConfigBackup(id) {
        if (this.lifecycle === 'RUNNING' || this.lifecycle === 'STARTING' || this.lifecycle === 'STOPPING') throw Object.assign(new Error('Backend must be stopped before restoring configuration.'), { code: 'CONFIG_BACKUP_BACKEND_MUST_STOP' });
        return this.backupCatalogService.restore(id, { verifyTarget: () => this.#validateConfigurationTree() });
    }

    listProfiles() { return this.botProfileUseCases.list(); }
    updateProfile(botId, fields) { return this.botProfileUseCases.update(botId, fields); }
    createProfile(fields = {}) { return this.botProfileUseCases.create(fields); }
    cloneProfile(botId, newId) { return this.botProfileUseCases.clone(botId, newId); }
    deleteProfile(botId) { return this.botProfileUseCases.remove(botId); }

    connect(botId) { return this.fleetControlUseCases.connect(botId); }
    disconnect(botId) { return this.fleetControlUseCases.disconnect(botId); }
    startMode(botId, mode) { return this.fleetControlUseCases.startMode(botId, mode); }
    pauseMode(botId) { return this.fleetControlUseCases.pauseMode(botId); }
    resumeMode(botId) { return this.fleetControlUseCases.resumeMode(botId); }
    stopMode(botId) { return this.fleetControlUseCases.stopMode(botId); }
    restartMode(botId) { return this.fleetControlUseCases.restartMode(botId); }

    async retryB5StorageProtection(botId, request = {}) {
        const runtime = this.#runtime(botId);
        const service = runtime.getService?.('b5CraftMode');
        if (!service?.requestStorageProtectionRetry) throw new Error(`B5 craft mode recovery is unavailable for ${botId}.`);
        return resultPayload(service.requestStorageProtectionRetry({
            expectedBotId: botId,
            expectedGeneration: request.expectedGeneration,
            episodeId: request.episodeId,
            incidentId: request.incidentId,
            idempotencyKey: request.idempotencyKey,
            reason: 'desktop-operator'
        }));
    }


    reconcileFleet(reason = 'desktop-reconcile') { return this.fleetControlUseCases.reconcile(reason); }
    fleetAction(action) { return this.fleetControlUseCases.fleetAction(action); }

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
        const backup = await this.backupCatalogService.create({ reason: 'manual', sourceAction: 'desktop-backup' });
        this.#publishLog({
            timestamp: VietnamTime.iso(),
            level: 'info',
            scope: 'Desktop',
            message: 'Configuration backup created.',
            meta: { backupId: backup.id }
        });
        return { id: backup.id, path: backup.path, createdAt: backup.createdAt, manifest: backup.manifest };
    }

    async exportSupportBundle({ previewId = null } = {}) {
        const directory = path.join(this.baseDir, 'data', 'support');
        await fsp.mkdir(directory, { recursive: true });
        const now = Date.now();
        let payload = null;
        if (previewId) {
            const cached = this.supportPreviewCache;
            if (!cached || cached.previewId !== String(previewId) || cached.expiresAt <= now) {
                throw Object.assign(new Error('Bản xem trước gói hỗ trợ đã hết hạn; hãy xem trước lại trước khi xuất.'), { code: 'SUPPORT_BUNDLE_PREVIEW_EXPIRED' });
            }
            payload = cached.bundle;
        } else {
            const createdAt = VietnamTime.iso();
            payload = new SupportBundleBuilder().build(await this.#supportBundleInput(createdAt));
        }
        const createdAt = payload.createdAt;
        const filePath = path.join(directory, `support-${createdAt.replace(/[:.]/g, '-')}.json`);
        await fsp.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
        if (previewId) this.supportPreviewCache = null;
        return { path: filePath, createdAt, manifestHash: payload.manifestHash, warnings: payload.warnings };
    }

    async supportBundlePreview() {
        const createdAt = VietnamTime.iso();
        const builder = new SupportBundleBuilder();
        const bundle = builder.build(await this.#supportBundleInput(createdAt));
        const previewId = `support-preview:${randomUUID()}`;
        const expiresAt = Date.now() + SUPPORT_PREVIEW_TTL_MS;
        this.supportPreviewCache = { previewId, expiresAt, bundle };
        return { ...builder.previewBundle(bundle), previewId, expiresAt: new Date(expiresAt).toISOString() };
    }

    async #supportBundleInput(createdAt) {
        const diagnosticIndex = this.#runtimeFailureArtifacts().list({ limit: 20, hydrateMetadata: false });
        const entries = [
            { path: 'evidence/platform-snapshot-desktop.json', value: this.snapshot() },
            { path: 'evidence/log-summary-desktop.json', value: this.logSnapshot({ limit: 250 }), optional: true }
        ];
        const warnings = [...(diagnosticIndex.warnings || [])];
        let diagnosticSequence = 0;
        for (const artifact of diagnosticIndex.items) {
            if (Number(artifact.size) > SUPPORT_DIAGNOSTIC_MAX_BYTES) {
                warnings.push({
                    code: 'SUPPORT_RUNTIME_FAILURE_OVERSIZE_SKIPPED',
                    artifactId: artifact.id,
                    bytes: artifact.size,
                    maxBytes: SUPPORT_DIAGNOSTIC_MAX_BYTES
                });
                continue;
            }
            try {
                diagnosticSequence += 1;
                entries.push({
                    path: `evidence/runtime-failure-${String(diagnosticSequence).padStart(3, '0')}.json`,
                    value: { id: artifact.id, botId: artifact.botId, data: this.readDiagnostic(artifact.id) },
                    optional: true
                });
            } catch (error) {
                warnings.push({ code: 'SUPPORT_RUNTIME_FAILURE_SKIPPED', artifactId: artifact.id, message: error.message });
            }
        }
        const b5Replays = this.bundle?.application?.listRuntimes?.().map(runtime => ({
            botId: runtime.botId,
            fixture: runtime.getService?.('b5TraceRecorder')?.latestReplayFixture?.() || null
        })).filter(entry => entry.fixture) || [];
        for (const [index, replay] of b5Replays.entries()) {
            entries.push({ path: `evidence/replay-b5-${String(index + 1).padStart(3, '0')}.json`, value: replay, optional: true });
        }
        if (this.lifecycle === 'RUNNING') {
            try { entries.push({ path: 'evidence/mode-status-profiles.json', value: await this.listProfiles(), optional: true }); }
            catch (error) { warnings.push({ code: 'SUPPORT_PROFILES_SKIPPED', message: error.message }); }
        }
        return {
            createdAt,
            entries,
            warnings,
            pseudonymSalt: randomUUID()
        };
    }

    goHome(botId) { return this.fleetControlUseCases.home(botId); }


    collectorConfig(botId) { return this.modeConfigurationUseCases.collector(botId); }
    updateCollectorConfig(botId, fields = {}) { return this.modeConfigurationUseCases.updateCollector(botId, fields); }
    fishingConfig(botId) { return this.modeConfigurationUseCases.fishing(botId); }
    updateFishingArea(botId, fields = {}) { return this.modeConfigurationUseCases.updateFishingArea(botId, fields); }



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
            ...pick(fields, ['inventorySafetyEmptySlots','b3AllMinEmptySlots','b2InputSource']),
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
        return this.customModeUseCases.modules();
    }

    customModeTemplates() { return this.customModeUseCases.templates(); }

    customModeDryRun(definition, simulation = {}) {
        return Redactor.sanitize(this.customModeUseCases.dryRun(definition, simulation));
    }

    customModePackage(definition) {
        return Redactor.sanitize(this.customModeUseCases.package(definition));
    }

    modePresentations() {
        this.#requireRunning();
        return this.customModeUseCases.presentations();
    }

    customModes() {
        return this.customModeUseCases.list();
    }

    async saveCustomMode(definition, options = {}) {
        return Redactor.sanitize(await this.customModeUseCases.save(definition, options));
    }

    async deleteCustomMode(modeId) {
        return Redactor.sanitize(await this.customModeUseCases.remove(modeId));
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

    diagnostics({ limit = 40, botId = null } = {}) {
        return this.#runtimeFailureArtifacts().list({ limit, botId });
    }

    readDiagnostic(id) {
        return this.#runtimeFailureArtifacts().read(id);
    }

    #runtimeFailureArtifacts() {
        if (!this.runtimeFailureArtifactRepository) {
            this.runtimeFailureArtifactRepository = new RuntimeFailureArtifactRepository({
                baseDir: this.baseDir,
                configuration: this.bundle?.configuration || null
            });
        }
        return this.runtimeFailureArtifactRepository;
    }



    #configMutation(work) {
        const coordinator = this.bundle?.shared?.configMutations;
        return coordinator?.run ? coordinator.run('config-set', work) : work();
    }

    #validateConfigWorkspaceGroup(key, value) {
        this.#requireRunning();
        const spec = ConfigSpecs.find(entry => entry.key === key);
        if (!spec) return { valid: false, errors: [`Unknown configuration group: ${key}`] };
        const local = this.bundle.configuration.validator.validate(spec.schema, value);
        if (!local.valid) return local;
        const profiles = Object.values(this.bundle.fleetControl.profileSnapshot() || {});
        return this.bundle.configuration.crossValidator.validate({ ...this.bundle.configuration.registry.snapshot(), [key]: value }, { botProfiles: profiles, requireComplete: true });
    }

    async #validateConfigurationTree() {
        const loadConfiguration = require('../bootstrap/loadConfiguration');
        const loadBotProfiles = require('../bootstrap/loadBotProfiles');
        const configuration = await loadConfiguration({ baseDir: this.baseDir });
        const profiles = await loadBotProfiles({ loader: configuration.loader, validator: configuration.validator, directory: 'config/bots', environment: {} });
        configuration.crossValidator.assertValid(configuration.registry.snapshot(), { botProfiles: profiles, requireComplete: true });
        return { valid: true, groups: ConfigSpecs.length, profiles: profiles.length };
    }

    #trimIncidentActionCache() {
        const now = Date.now();
        for (const [key, entry] of this.incidentActionCache) if (!entry || entry.expiresAt <= now) this.incidentActionCache.delete(key);
        while (this.incidentActionCache.size > 64) this.incidentActionCache.delete(this.incidentActionCache.keys().next().value);
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
            connectionOnline: Boolean(client),
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
            const targets = [path.join(directory, `mcbot-desktop-${day}.jsonl`)];
            const botId = botIdFromLogRecord(record);
            if (botId) {
                const botDirectory = path.join(directory, 'bots', botId);
                fs.mkdirSync(botDirectory, { recursive: true });
                targets.push(path.join(botDirectory, `mcbot-desktop-${botId}-${day}.jsonl`));
            }
            const line = `${JSON.stringify(record)}\n`;
            for (const target of targets) {
                fs.appendFile(target, line, error => {
                    if (error) this.#recordLogPersistenceFailure(error);
                });
            }
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
        const botId = botIdFromLogRecord(record);
        const sanitized = Redactor.sanitize({
            timestamp: record?.timestamp || VietnamTime.iso(),
            level: record?.level || 'info',
            scope: record?.scope || 'Application',
            message: record?.message || '',
            meta: botId ? { ...(record?.meta || {}), botId } : record?.meta || null
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
