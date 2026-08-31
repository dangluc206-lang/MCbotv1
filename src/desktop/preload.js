'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const SnapshotRevisionGate = require('./SnapshotRevisionGate');

const snapshotGate = new SnapshotRevisionGate();

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args).then(result => {
    if (channel !== 'mcbot:snapshot' || !result?.success) return result;
    const snapshot = result.data;
    if (snapshotGate.accept(snapshot)) return result;
    return { ...result, data: snapshotGate.lastSnapshot };
});

function subscribe(channel, listener) {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, payload) => {
        if (channel === 'mcbot:snapshot' && !snapshotGate.accept(payload)) return;
        listener(payload);
    };
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('mcbot', Object.freeze({
    backendStart: () => invoke('mcbot:backend:start'),
    backendStop: () => invoke('mcbot:backend:stop'),
    backendRestart: () => invoke('mcbot:backend:restart'),
    snapshot: () => invoke('mcbot:snapshot'),
    operatorSnapshot: () => invoke('mcbot:operator-snapshot'),
    botDetail: (botId, expectedRevision) => invoke('mcbot:bot:detail', botId, expectedRevision),
    health: options => invoke('mcbot:health', options),
    readiness: () => invoke('mcbot:readiness'),
    b5Journey: botId => invoke('mcbot:b5:journey', botId),
    incidents: options => invoke('mcbot:incidents:list', options),
    readIncident: incidentId => invoke('mcbot:incidents:read', incidentId),
    transitionIncident: (incidentId, state, options) => invoke('mcbot:incidents:transition', incidentId, state, options),
    executeIncidentAction: (incidentId, action, request) => invoke('mcbot:incidents:action', incidentId, action, request),
    profiles: () => invoke('mcbot:profiles:list'),
    updateProfile: (botId, fields) => invoke('mcbot:profiles:update', botId, fields),
    createProfile: fields => invoke('mcbot:profiles:create', fields),
    cloneProfile: (botId, newId) => invoke('mcbot:profiles:clone', botId, newId),
    deleteProfile: botId => invoke('mcbot:profiles:delete', botId),
    appInfo: () => invoke('mcbot:app:info'),
    localUpdateStatus: () => invoke('mcbot:update:local-status'),
    selectLocalUpdateZip: () => invoke('mcbot:update:local-select'),
    clearLocalUpdateZip: () => invoke('mcbot:update:local-clear'),
    installLocalUpdateZip: () => invoke('mcbot:update:local-install'),
    updateMigrationStatus: () => invoke('mcbot:update:migration-status'),
    rollbackConfigMigration: () => invoke('mcbot:update:rollback-config'),
    aiStatus: options => invoke('mcbot:ai:status', options),
    selectAiWorkspace: () => invoke('mcbot:ai:workspace:select'),
    inspectAiWorkspace: workspaceRoot => invoke('mcbot:ai:workspace:inspect', workspaceRoot),
    aiChat: request => invoke('mcbot:ai:chat', request),
    reportRendererError: payload => invoke('mcbot:renderer:error', payload),
    connect: botId => invoke('mcbot:bot:connect', botId),
    disconnect: botId => invoke('mcbot:bot:disconnect', botId),
    startMode: (botId, mode) => invoke('mcbot:mode:start', botId, mode),
    pauseMode: botId => invoke('mcbot:mode:pause', botId),
    resumeMode: botId => invoke('mcbot:mode:resume', botId),
    stopMode: botId => invoke('mcbot:mode:stop', botId),
    restartMode: botId => invoke('mcbot:mode:restart', botId),
    retryB5StorageProtection: (botId, request) => invoke('mcbot:mode:b5-retry-storage-protection', botId, request),
    goHome: botId => invoke('mcbot:bot:home', botId),
    fleetAction: action => invoke('mcbot:fleet:action', action),
    commands: () => invoke('mcbot:commands'),
    sendCommand: (botId, options) => invoke('mcbot:command:send', botId, options),
    skyCommands: () => invoke('mcbot:sky-commands:get'),
    saveSkyCommand: definition => invoke('mcbot:sky-commands:save', definition),
    deleteSkyCommand: (skyId, commandId) => invoke('mcbot:sky-commands:delete', skyId, commandId),
    sendSkyCommand: (botId, options) => invoke('mcbot:sky-commands:send', botId, options),
    collectorConfig: botId => invoke('mcbot:config:collector:get', botId),
    updateCollectorConfig: (botId, fields) => invoke('mcbot:config:collector:update', botId, fields),
    fishingConfig: botId => invoke('mcbot:config:fishing:get', botId),
    updateFishingArea: (botId, fields) => invoke('mcbot:config:fishing:update-area', botId, fields),
    b5CraftConfig: () => invoke('mcbot:config:b5-craft:get'),
    b5RulesConfig: () => invoke('mcbot:config:b5-rules:get'),
    updateB5RulesConfig: fields => invoke('mcbot:config:b5-rules:update', fields),
    updateB5CraftConfig: fields => invoke('mcbot:config:b5-craft:update', fields),
    storageProtectionConfig: () => invoke('mcbot:config:storage-protection:get'),
    updateStorageProtectionConfig: fields => invoke('mcbot:config:storage-protection:update', fields),
    skyAutoJoinConfig: () => invoke('mcbot:config:sky-auto-join:get'),
    updateSkyAutoJoinConfig: fields => invoke('mcbot:config:sky-auto-join:update', fields),
    configGroups: () => invoke('mcbot:config:groups'),
    configGroup: key => invoke('mcbot:config:group:get', key),
    saveConfigGroup: (key, value) => invoke('mcbot:config:group:save', key, value),
    openConfigWorkspace: key => invoke('mcbot:config:workspace:open', key),
    previewConfigWorkspace: (sessionId, value) => invoke('mcbot:config:workspace:preview', sessionId, value),
    saveConfigWorkspace: (sessionId, value, options) => invoke('mcbot:config:workspace:save', sessionId, value, options),
    undoConfigWorkspace: sessionId => invoke('mcbot:config:workspace:undo', sessionId),
    closeConfigWorkspace: sessionId => invoke('mcbot:config:workspace:close', sessionId),
    customModeModules: () => invoke('mcbot:custom-mode:modules'),
    customModeTemplates: () => invoke('mcbot:custom-mode:templates'),
    customModeDryRun: (definition, simulation) => invoke('mcbot:custom-mode:dry-run', definition, simulation),
    customModePackage: definition => invoke('mcbot:custom-mode:package', definition),
    modePresentations: () => invoke('mcbot:mode:presentations'),
    customModes: () => invoke('mcbot:custom-mode:list'),
    saveCustomMode: (definition, options) => invoke('mcbot:custom-mode:save', definition, options),
    deleteCustomMode: modeId => invoke('mcbot:custom-mode:delete', modeId),
    backupConfig: () => invoke('mcbot:config:backup'),
    configBackups: options => invoke('mcbot:config:backups', options),
    previewConfigRestore: backupId => invoke('mcbot:config:restore-preview', backupId),
    restoreConfigBackup: backupId => invoke('mcbot:config:restore', backupId),
    inspectGui: (botId, options) => invoke('mcbot:gui:inspect', botId, options),
    logs: limit => invoke('mcbot:logs', limit),
    diagnostics: limit => invoke('mcbot:diagnostics:list', limit),
    readDiagnostic: artifactId => invoke('mcbot:diagnostics:read', artifactId),
    exportSupportBundle: request => invoke('mcbot:support:export', request),
    supportBundlePreview: () => invoke('mcbot:support:preview'),
    secretStatus: () => invoke('mcbot:secrets:status'),
    setSecret: (key, value) => invoke('mcbot:secrets:set', key, value),
    clearSecret: key => invoke('mcbot:secrets:clear', key),
    resetSecretStore: () => invoke('mcbot:secrets:reset'),
    preferences: () => invoke('mcbot:preferences:get'),
    setPreferences: patch => invoke('mcbot:preferences:set', patch),
    searchPresentation: (query, options) => invoke('mcbot:presentation:search', query, options),
    openProjectFolder: () => invoke('mcbot:shell:project'),
    openLogFolder: () => invoke('mcbot:shell:logs'),
    openBackupFolder: () => invoke('mcbot:shell:backups'),
    openSupportFolder: () => invoke('mcbot:shell:support'),
    onLog: listener => subscribe('mcbot:log', listener),
    onSnapshot: listener => subscribe('mcbot:snapshot', listener),
    onOperatorSnapshot: listener => subscribe('mcbot:operator-snapshot', listener)
}));
