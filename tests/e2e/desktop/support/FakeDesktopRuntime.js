'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FIXED_TIME = '2026-08-24T00:00:00.000Z';

const SAFE_NOOP_CHANNELS = new Set([
    'mcbot:profiles:update', 'mcbot:profiles:create', 'mcbot:profiles:clone', 'mcbot:profiles:delete',
    'mcbot:bot:connect', 'mcbot:bot:disconnect', 'mcbot:bot:home',
    'mcbot:mode:start', 'mcbot:mode:pause', 'mcbot:mode:resume', 'mcbot:mode:stop', 'mcbot:mode:restart', 'mcbot:mode:b5-retry-storage-protection',
    'mcbot:fleet:action', 'mcbot:command:send', 'mcbot:sky-commands:save', 'mcbot:sky-commands:delete', 'mcbot:sky-commands:send',
    'mcbot:config:collector:update', 'mcbot:config:fishing:update-area', 'mcbot:config:b5-rules:update', 'mcbot:config:b5-craft:update',
    'mcbot:config:storage-protection:update', 'mcbot:config:sky-auto-join:update', 'mcbot:config:group:save',
    'mcbot:config:workspace:save', 'mcbot:config:workspace:undo', 'mcbot:config:workspace:close',
    'mcbot:incidents:transition', 'mcbot:incidents:action', 'mcbot:config:restore',
    'mcbot:custom-mode:save', 'mcbot:custom-mode:delete', 'mcbot:config:backup', 'mcbot:gui:inspect',
    'mcbot:diagnostics:read', 'mcbot:support:export', 'mcbot:support:preview', 'mcbot:secrets:set', 'mcbot:secrets:clear', 'mcbot:secrets:reset', 'mcbot:preferences:set',
    'mcbot:shell:project', 'mcbot:shell:logs', 'mcbot:shell:backups', 'mcbot:shell:support',
    'mcbot:update:local-select', 'mcbot:update:local-clear', 'mcbot:update:local-install', 'mcbot:update:rollback-config',
    'mcbot:ai:workspace:select', 'mcbot:ai:workspace:inspect', 'mcbot:ai:chat'
]);

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

class FakeDesktopRuntime {
    constructor({ fixtureRoot, specs, appVersion = '0.0.0-test' }) {
        this.fixtureRoot = path.resolve(fixtureRoot);
        if (!Array.isArray(specs) || specs.length === 0) throw new TypeError('ConfigSpecs-derived specs are required.');
        this.manifest = {
            appVersion,
            specs: specs.map(spec => ({ key: spec.key, file: spec.file, schema: spec.schema }))
        };
        this.configByKey = new Map(this.manifest.specs.map(spec => [spec.key, this.#readJson(spec.file)]));
        this.profile = this.#readJson('fixture-profile.json');
        this.lifecycle = 'STOPPED';
        this.rendererErrors = [];
        this.logs = [];
        this.sequence = 0;
    }

    #readJson(relative) {
        const target = path.resolve(this.fixtureRoot, relative);
        const prefix = `${this.fixtureRoot}${path.sep}`;
        if (target !== this.fixtureRoot && !target.startsWith(prefix)) throw new Error(`Fixture path escaped root: ${relative}`);
        return JSON.parse(fs.readFileSync(target, 'utf8'));
    }

    snapshot() {
        const running = this.lifecycle === 'RUNNING';
        return {
            lifecycle: this.lifecycle,
            updatedAt: FIXED_TIME,
            system: { uptimeMs: running ? 12345 : 0, memoryMb: 64 },
            bots: running ? [this.#botSnapshot()] : []
        };
    }

    #botSnapshot() {
        return {
            botId: this.profile.id,
            profile: clone(this.profile),
            state: { connectionState: 'DISCONNECTED', lastError: null },
            player: null,
            modeOwner: null,
            intent: { desiredMode: null, modeState: 'STOPPED' },
            operation: { active: 0, operations: [] },
            modes: {
                available: [
                    { definition: { id: 'b5-craft', label: 'Chế B5 thuần' } },
                    { definition: { id: 'fishing', label: 'Câu cá' } }
                ],
                byId: {}
            }
        };
    }

    start() { this.lifecycle = 'RUNNING'; return this.snapshot(); }
    stop() { this.lifecycle = 'STOPPED'; return this.snapshot(); }
    restart() { this.lifecycle = 'RUNNING'; return this.snapshot(); }
    fail() { this.lifecycle = 'FAILED'; return this.snapshot(); }

    configGroup(key) {
        const spec = this.manifest.specs.find(entry => entry.key === key);
        if (!spec) throw new Error(`Unknown fixture config group: ${key}`);
        return { ...spec, value: clone(this.configByKey.get(key)) };
    }

    async handle(channel, ...args) {
        this.sequence += 1;
        switch (channel) {
        case 'mcbot:backend:start': return this.start();
        case 'mcbot:backend:stop': return this.stop();
        case 'mcbot:backend:restart': return this.restart();
        case 'mcbot:snapshot': return this.snapshot();
        case 'mcbot:health': return { contract: 'operator-health-v1', overall: this.lifecycle === 'RUNNING' ? 'HEALTHY' : 'UNKNOWN', stale: false, cached: false, ageMs: 0, sampledAt: FIXED_TIME, probes: [] };
        case 'mcbot:readiness': return { contract: 'desktop-readiness-v1', overall: this.lifecycle === 'RUNNING' ? 'READY' : 'INCOMPLETE', checks: [], sideEffects: 'NONE' };
        case 'mcbot:b5:journey': return { contract: 'b5-operator-presentation-v1', items: [], projectedAt: FIXED_TIME };
        case 'mcbot:incidents:list': return { contract: 'desktop-incident-index-v1', items: [], warnings: [] };
        case 'mcbot:profiles:list': return this.lifecycle === 'RUNNING' ? [clone(this.profile)] : [];
        case 'mcbot:commands': return [];
        case 'mcbot:sky-commands:get': return { value: {}, selections: ['sky1', 'sky2'] };
        case 'mcbot:config:groups': return this.manifest.specs.map(spec => ({ ...spec }));
        case 'mcbot:config:group:get': return this.configGroup(args[0]);
        case 'mcbot:config:workspace:open': { const group = this.configGroup(args[0]); return { contract:'desktop-config-workspace-v1', sessionId:`session:${args[0]}`, key:args[0], file:group.file, schema:group.schema, revision:'fixture-revision', dirty:false, value:group.value, openedAt:FIXED_TIME }; }
        case 'mcbot:config:workspace:preview': return { contract:'desktop-config-workspace-v1', sessionId:args[0], key:String(args[0]).split(':').at(-1), loadedRevision:'fixture-revision', draftDigest:'fixture-draft', dirty:false, valid:true, errors:[], changes:[], impact:'BACKEND_RESTART' };
        case 'mcbot:config:backups': return [];
        case 'mcbot:custom-mode:modules': return [];
        case 'mcbot:custom-mode:templates': return [];
        case 'mcbot:custom-mode:list': return [];
        case 'mcbot:config:b5-craft:get': return this.configGroup('b5CraftMode');
        case 'mcbot:config:b5-rules:get': return this.configGroup('b5');
        case 'mcbot:config:storage-protection:get': return { value: { sellBlockOnly: true, collectorB1Decompression: { maxUsageRatio: 0.8, requireKnownCapacity: true } } };
        case 'mcbot:config:sky-auto-join:get': return { value: clone(this.configByKey.get('skyblock')) };
        case 'mcbot:config:collector:get': return clone(this.configByKey.get('collectorB5Mode'));
        case 'mcbot:config:fishing:get': return { resolved: clone(this.configByKey.get('fishingMode')), overrides: {} };
        case 'mcbot:logs': return clone(this.logs);
        case 'mcbot:diagnostics:list': return { contract: 'runtime-failure-artifact-v1', items: [], warnings: [] };
        case 'mcbot:support:preview': return { contract: 'support-bundle', version: 2, previewId: 'support-preview:e2e', entryCount: 2, totalBytes: 1024, privacy: { default: 'PSEUDONYMIZED' }, warnings: [], files: [] };
        case 'mcbot:app:info': return { version: this.manifest.appVersion, name: 'MCbot Desktop', packaged: false, platform: process.platform, arch: process.arch };
        case 'mcbot:update:local-status': return { currentVersion: this.manifest.appVersion, phase: 'IDLE', selected: null, lastError: null };
        case 'mcbot:update:migration-status': return { lastBackup: null };
        case 'mcbot:preferences:get': return { closeToTray: false, notifyErrors: true, snapshotIntervalMs: 900, startBackendOnLaunch: false, preventSystemSleepWhileActive: false, launchAtLogin: false, experienceLevel:'advanced', colorTheme:'dark', firstRun:{ status:'COMPLETED', step:6, startedAt:FIXED_TIME, completedAt:FIXED_TIME, durationMs:0 }, loginItem: { supported: false, openAtLogin: false } };
        case 'mcbot:secrets:status': return { state: 'NOT_CONFIGURED', encryptionAvailable: true, keys: [], recovery: null };
        case 'mcbot:ai:status': return { models: [] };
        case 'mcbot:renderer:error': this.rendererErrors.push(clone(args[0])); return { recorded: true };
        default:
            if (SAFE_NOOP_CHANNELS.has(channel)) return { accepted: true };
            throw new Error(`Unhandled E2E IPC channel: ${channel}`);
        }
    }
}

module.exports = FakeDesktopRuntime;
