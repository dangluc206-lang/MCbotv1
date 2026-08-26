'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, shell, safeStorage, Tray, Menu, Notification, powerMonitor, powerSaveBlocker, screen, dialog } = require('electron');
const { spawn } = require('node:child_process');
const DesktopController = require('./DesktopController');
const DesktopPreferenceStore = require('./DesktopPreferenceStore');
const DesktopRuntimeBootstrap = require('./use-cases/DesktopRuntimeBootstrap');
const LocalZipUpdateService = require('./update/LocalZipUpdateService');
require('./update/local-update-helper');
const localUpdateHelperPath = require.resolve('./update/local-update-helper');
const LocalAiService = require('../ai/LocalAiService');
const { handleSquirrelLifecycle } = require('./update/SquirrelLifecycle');
const { runDesktopShutdownSequence } = require('./DesktopShutdownSequence');
const { CrashMarkerStore, createDesktopFatalRecovery } = require('./DesktopFatalRecovery');
const IncidentIndexStore = require('./incidents/IncidentIndexStore');
const DesktopReadinessService = require('./readiness/DesktopReadinessService');
const CommandPaletteCatalog = require('./presentation/CommandPaletteCatalog');
const DesktopApiContract = require('./contracts/DesktopApiContract');
const SnapshotDeliveryCoordinator = require('./projection/SnapshotDeliveryCoordinator');

const templateRoot = path.resolve(__dirname, '..', '..');
const rendererFile = path.join(__dirname, 'renderer', 'index.html');
const rendererUrl = pathToFileURL(rendererFile).href;
const trayIcon = path.join(templateRoot, 'assets', process.platform === 'win32' ? 'mcbot.ico' : 'mcbot.png');

let runtimeDir = templateRoot;
let controller = null;
let secretStore = null;
let preferenceStore = null;
let mainWindow = null;
let tray = null;
let quitting = false;
let snapshotTimer = null;
let powerBlockerId = null;
let lastSnapshot = null;
let windowStateTimer = null;
let localUpdateService = null;
let runtimeMigrator = null;
let runtimeBootstrap = null;
let aiService = null;
let readinessService = null;
let operatorSnapshotDelivery = null;
let rendererRecovery = { startedAt: 0, count: 0 };
const notificationHistory = new Map();
const launchedHidden = process.argv.includes('--hidden');
const crashMarkerStore = new CrashMarkerStore({ directory: path.join(app.getPath('userData'), 'crash-recovery') });
const fatalRecovery = createDesktopFatalRecovery({
    markerStore: crashMarkerStore,
    timeoutMs: 5000,
    drain: async () => {
        if (snapshotTimer) { clearTimeout(snapshotTimer); snapshotTimer = null; }
        if (windowStateTimer) { clearTimeout(windowStateTimer); windowStateTimer = null; }
        await Promise.allSettled([preferenceStore?.drain?.(), controller?.stop?.('Desktop fatal recovery.')]);
    },
    relaunch: () => app.relaunch(),
    terminate: code => app.exit(code)
});
process.on('uncaughtException', error => { fatalRecovery.handle(error, 'uncaught-exception'); });
process.on('unhandledRejection', reason => { fatalRecovery.handle(reason instanceof Error ? reason : new Error(String(reason)), 'unhandled-rejection'); });


function reportDesktopFailure(error, source) {
    const value = error instanceof Error ? error : new Error(String(error?.message || error || 'Unknown desktop failure'));
    const payload = { message: value.message, stack: value.stack || null, source };
    try {
        if (controller?.reportRendererError) {
            controller.reportRendererError(payload);
            return;
        }
    } catch (reportError) {
        console.error(`[MCbot desktop:${source}:report-failed]`, reportError?.stack || reportError);
    }
    console.error(`[MCbot desktop:${source}]`, value.stack || value);
}

const squirrelHandled = handleSquirrelLifecycle({ app });
const hasSingleInstanceLock = squirrelHandled ? false : app.requestSingleInstanceLock();
if (!squirrelHandled && !hasSingleInstanceLock) app.quit();

async function selectLocalUpdateZip() {
    if (!localUpdateService) throw new Error('Dịch vụ cập nhật ZIP chưa sẵn sàng.');
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
        title: 'Chọn gói cập nhật MCbot',
        properties: ['openFile'],
        filters: [{ name: 'Gói cập nhật MCbot', extensions: ['zip'] }]
    });
    if (result.canceled || !result.filePaths?.[0]) return localUpdateService.status();
    return localUpdateService.inspect(result.filePaths[0]);
}

async function installLocalUpdateZip() {
    if (!localUpdateService) throw new Error('Dịch vụ cập nhật ZIP chưa sẵn sàng.');
    const localStatus = localUpdateService.status();
    if (localStatus.phase !== 'READY' || !localStatus.selected) throw new Error('Chưa chọn gói ZIP cập nhật hợp lệ.');

    const wasRunning = controller?.lifecycle === 'RUNNING';
    let backup = null;
    if (wasRunning) backup = await controller.backupConfig();
    const restartArgs = app.isPackaged ? [] : [templateRoot];
    const prepared = await localUpdateService.prepareInstall({
        parentPid: process.pid,
        restartExe: process.execPath,
        restartArgs,
        configBackup: backup?.path || null
    });

    try {
        if (controller && controller.lifecycle !== 'STOPPED') {
            await controller.stop('Đang chuẩn bị cập nhật MCbot từ file ZIP.');
        }

        if (!fs.existsSync(localUpdateHelperPath)) throw new Error('Thiếu tiến trình trợ giúp cập nhật ZIP.');
        const child = spawn(process.execPath, [localUpdateHelperPath, prepared.planPath], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
        });
        await new Promise((resolve, reject) => {
            child.once('spawn', resolve);
            child.once('error', reject);
        });
        child.unref();
    } catch (error) {
        await localUpdateService.cancelPreparedInstall(prepared.planPath).catch(cancelError => reportDesktopFailure(cancelError, 'local-update-cancel-prepared'));
        if (wasRunning && controller?.lifecycle === 'STOPPED') {
            await controller.start().catch(startError => reportDesktopFailure(startError, 'local-update-backend-restore'));
        }
        throw error;
    }

    setTimeout(() => app.quit(), 200).unref?.();
    return {
        launched: true,
        version: prepared.version,
        backup: backup?.path || null,
        programBackup: prepared.backupRoot
    };
}

async function rollbackLastConfigMigration() {
    if (!runtimeMigrator) throw new Error('Khôi phục migration chỉ khả dụng trên bản đã cài.');
    const wasRunning = controller?.lifecycle === 'RUNNING';
    if (wasRunning) await controller.stop('Khôi phục cấu hình trước migration.');
    const result = await runtimeMigrator.rollbackLastConfig();
    if (wasRunning) await controller.start();
    publishSnapshot();
    return result;
}

async function restoreConfigBackup(backupId) {
    const wasRunning = controller?.lifecycle === 'RUNNING';
    if (wasRunning) await controller.stop('Đang khôi phục backup cấu hình.');
    try {
        const result = await controller.restoreConfigBackup(backupId);
        if (wasRunning) await controller.start();
        publishSnapshot();
        return result;
    } catch (error) {
        if (wasRunning && controller?.lifecycle !== 'RUNNING') await controller.start().catch(startError => reportDesktopFailure(startError, 'config-restore-backend-recovery'));
        publishSnapshot();
        throw error;
    }
}

function serializeFailure(error) {
    return DesktopApiContract.failure(error);
}

function isTrustedSender(event) {
    const url = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
    return url === rendererUrl;
}

function safeHandle(channel, handler) {
    if (!DesktopApiContract.CATALOG[channel]) throw new Error(`Desktop IPC channel is not declared in DesktopApiContract: ${channel}`);
    ipcMain.handle(channel, async (event, ...args) => {
        try {
            if (!isTrustedSender(event)) {
                const error = new Error(`Rejected IPC from untrusted sender for ${channel}.`);
                error.code = 'DESKTOP_IPC_UNTRUSTED_SENDER';
                throw error;
            }
            DesktopApiContract.validateRequest(channel, args);
            return DesktopApiContract.success(await handler(...args));
        } catch (error) {
            return serializeFailure(error);
        }
    });
}

function showMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    publishSnapshot();
}

async function openPathChecked(target) {
    await fs.promises.mkdir(target, { recursive: true });
    const failure = await shell.openPath(target);
    if (failure) throw new Error(failure);
    return { path: target };
}

async function restartBackend() {
    await controller.stop('Backend restart requested from desktop.').catch(error => reportDesktopFailure(error, 'backend-restart-stop'));
    controller.configureEnvironment(runtimeBootstrap.resolveEnvironment());
    const result = await controller.start();
    publishSnapshot();
    return result;
}

function loginItemOptions() {
    if (process.platform !== 'win32' || !app.isPackaged) return null;
    const appFolder = path.dirname(process.execPath);
    const executableName = path.basename(process.execPath);
    return { path: path.resolve(appFolder, '..', executableName), args: ['--hidden'] };
}

function getLoginItemSetting() {
    const options = loginItemOptions();
    if (!options) return { supported: false, openAtLogin: false };
    const state = app.getLoginItemSettings(options);
    return { supported: true, openAtLogin: Boolean(state.openAtLogin), executableWillLaunchAtLogin: Boolean(state.executableWillLaunchAtLogin) };
}

function applyLoginItemSetting(enabled) {
    const options = loginItemOptions();
    if (!options) return { supported: false, openAtLogin: false };
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), ...options });
    return getLoginItemSetting();
}

function registerIpc() {
    safeHandle('mcbot:backend:start', async () => { const value = await controller.start(); publishSnapshot(); return value; });
    safeHandle('mcbot:backend:stop', async () => { const value = await controller.stop('Stopped from desktop UI.'); publishSnapshot(); return value; });
    safeHandle('mcbot:backend:restart', () => restartBackend());
    safeHandle('mcbot:snapshot', () => controller.snapshot());
    safeHandle('mcbot:operator-snapshot', () => controller.operatorSnapshot());
    safeHandle('mcbot:bot:detail', (botId, expectedRevision) => controller.botOperatorDetail(botId, expectedRevision));
    safeHandle('mcbot:health', options => controller.operatorHealth(options || {}));
    safeHandle('mcbot:readiness', () => readinessService.sample());
    safeHandle('mcbot:b5:journey', botId => controller.b5OperatorJourney(botId));
    safeHandle('mcbot:incidents:list', options => controller.incidents(options || {}));
    safeHandle('mcbot:incidents:read', incidentId => controller.incident(incidentId));
    safeHandle('mcbot:incidents:transition', (incidentId, state, options) => controller.transitionIncident(incidentId, state, options || {}));
    safeHandle('mcbot:incidents:action', (incidentId, action, request) => controller.executeIncidentAction(incidentId, action, request || {}));
    safeHandle('mcbot:profiles:list', () => controller.listProfiles());
    safeHandle('mcbot:profiles:update', (botId, fields) => controller.updateProfile(botId, fields));
    safeHandle('mcbot:profiles:create', fields => controller.createProfile(fields));
    safeHandle('mcbot:profiles:clone', (botId, newId) => controller.cloneProfile(botId, newId));
    safeHandle('mcbot:profiles:delete', botId => controller.deleteProfile(botId));
    safeHandle('mcbot:app:info', () => ({ version: app.getVersion(), name: app.getName(), packaged: app.isPackaged, platform: process.platform, arch: process.arch }));
    safeHandle('mcbot:update:migration-status', () => runtimeMigrator?.status?.() || null);
    safeHandle('mcbot:update:rollback-config', () => rollbackLastConfigMigration());
    safeHandle('mcbot:update:local-status', () => localUpdateService?.status?.() || null);
    safeHandle('mcbot:update:local-select', () => selectLocalUpdateZip());
    safeHandle('mcbot:update:local-clear', () => localUpdateService?.clear?.());
    safeHandle('mcbot:update:local-install', () => installLocalUpdateZip());
    safeHandle('mcbot:ai:status', options => aiService.status(options || {}));
    safeHandle('mcbot:ai:workspace:select', async () => {
        const result = await dialog.showOpenDialog(mainWindow || undefined, {
            title: 'Chọn thư mục project cho Local AI',
            properties: ['openDirectory']
        });
        if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
        const workspace = await aiService.inspectWorkspace(result.filePaths[0]);
        return { canceled: false, workspace };
    });
    safeHandle('mcbot:ai:workspace:inspect', workspaceRoot => aiService.inspectWorkspace(workspaceRoot));
    safeHandle('mcbot:ai:chat', request => aiService.runAgent(request || {}));
    safeHandle('mcbot:renderer:error', payload => controller.reportRendererError(payload));
    safeHandle('mcbot:bot:connect', botId => controller.connect(botId));
    safeHandle('mcbot:bot:disconnect', botId => controller.disconnect(botId));
    safeHandle('mcbot:mode:start', (botId, mode) => controller.startMode(botId, mode));
    safeHandle('mcbot:mode:pause', botId => controller.pauseMode(botId));
    safeHandle('mcbot:mode:resume', botId => controller.resumeMode(botId));
    safeHandle('mcbot:mode:stop', botId => controller.stopMode(botId));
    safeHandle('mcbot:mode:restart', botId => controller.restartMode(botId));
    safeHandle('mcbot:mode:b5-retry-storage-protection', (botId, request) => controller.retryB5StorageProtection(botId, request));
    safeHandle('mcbot:bot:home', botId => controller.goHome(botId));
    safeHandle('mcbot:fleet:action', action => controller.fleetAction(action));
    safeHandle('mcbot:commands', () => controller.commandOptions());
    safeHandle('mcbot:command:send', (botId, options) => controller.sendRegisteredCommand(botId, options));
    safeHandle('mcbot:sky-commands:get', () => controller.skyCommandsConfig());
    safeHandle('mcbot:sky-commands:save', definition => controller.upsertSkyCommand(definition));
    safeHandle('mcbot:sky-commands:delete', (skyId, commandId) => controller.deleteSkyCommand(skyId, commandId));
    safeHandle('mcbot:sky-commands:send', (botId, options) => controller.sendSkyCommand(botId, options));
    safeHandle('mcbot:config:collector:get', botId => controller.collectorConfig(botId));
    safeHandle('mcbot:config:collector:update', (botId, fields) => controller.updateCollectorConfig(botId, fields));
    safeHandle('mcbot:config:fishing:get', botId => controller.fishingConfig(botId));
    safeHandle('mcbot:config:fishing:update-area', (botId, fields) => controller.updateFishingArea(botId, fields));
    safeHandle('mcbot:config:b5-craft:get', () => controller.b5CraftConfig());
    safeHandle('mcbot:config:b5-rules:get', () => controller.b5RulesConfig());
    safeHandle('mcbot:config:b5-rules:update', fields => controller.updateB5RulesConfig(fields));
    safeHandle('mcbot:config:b5-craft:update', fields => controller.updateB5CraftConfig(fields));
    safeHandle('mcbot:config:storage-protection:get', () => controller.storageProtectionConfig());
    safeHandle('mcbot:config:storage-protection:update', fields => controller.updateStorageProtectionConfig(fields));
    safeHandle('mcbot:config:sky-auto-join:get', () => controller.skyAutoJoinConfig());
    safeHandle('mcbot:config:sky-auto-join:update', fields => controller.updateSkyAutoJoinConfig(fields));
    safeHandle('mcbot:config:groups', () => controller.configGroups());
    safeHandle('mcbot:config:group:get', key => controller.configGroup(key));
    safeHandle('mcbot:config:group:save', (key, value) => controller.saveConfigGroup(key, value));
    safeHandle('mcbot:config:workspace:open', key => controller.openConfigWorkspace(key));
    safeHandle('mcbot:config:workspace:preview', (sessionId, value) => controller.previewConfigWorkspace(sessionId, value));
    safeHandle('mcbot:config:workspace:save', (sessionId, value, options) => controller.saveConfigWorkspace(sessionId, value, options || {}));
    safeHandle('mcbot:config:workspace:undo', sessionId => controller.undoConfigWorkspace(sessionId));
    safeHandle('mcbot:config:workspace:close', sessionId => controller.closeConfigWorkspace(sessionId));
    safeHandle('mcbot:custom-mode:modules', () => controller.customModeModules());
    safeHandle('mcbot:custom-mode:templates', () => controller.customModeTemplates());
    safeHandle('mcbot:custom-mode:dry-run', (definition, simulation) => controller.customModeDryRun(definition, simulation || {}));
    safeHandle('mcbot:custom-mode:package', definition => controller.customModePackage(definition));
    safeHandle('mcbot:mode:presentations', () => controller.modePresentations());
    safeHandle('mcbot:custom-mode:list', () => controller.customModes());
    safeHandle('mcbot:custom-mode:save', (definition, options) => controller.saveCustomMode(definition, options || {}));
    safeHandle('mcbot:custom-mode:delete', modeId => controller.deleteCustomMode(modeId));
    safeHandle('mcbot:config:backup', () => controller.backupConfig());
    safeHandle('mcbot:config:backups', options => controller.backupCatalog(options || {}));
    safeHandle('mcbot:config:restore-preview', backupId => controller.previewConfigRestore(backupId));
    safeHandle('mcbot:config:restore', backupId => restoreConfigBackup(backupId));
    safeHandle('mcbot:gui:inspect', (botId, options) => controller.inspectGui(botId, options));
    safeHandle('mcbot:logs', limit => controller.logSnapshot({ limit }));
    safeHandle('mcbot:diagnostics:list', limit => controller.diagnostics({ limit }));
    safeHandle('mcbot:diagnostics:read', artifactId => controller.readDiagnostic(artifactId));
    safeHandle('mcbot:support:export', request => controller.exportSupportBundle(request));
    safeHandle('mcbot:support:preview', () => controller.supportBundlePreview());
    safeHandle('mcbot:secrets:status', () => secretStore.status());
    safeHandle('mcbot:secrets:set', (key, value) => secretStore.set(key, value));
    safeHandle('mcbot:secrets:clear', key => secretStore.clear(key));
    safeHandle('mcbot:secrets:reset', () => secretStore.reset());
    safeHandle('mcbot:preferences:get', () => ({ ...preferenceStore.snapshot(), loginItem: getLoginItemSetting() }));
    safeHandle('mcbot:preferences:set', async patch => {
        const values = await preferenceStore.update(patch || {});
        const loginItem = applyLoginItemSetting(values.launchAtLogin);
        updateTray();
        updatePowerBlocker();
        scheduleSnapshotLoop(true);
        return { ...values, loginItem };
    });
    safeHandle('mcbot:presentation:search', (query, options) => CommandPaletteCatalog.search(query, { experienceLevel: preferenceStore.get('experienceLevel'), ...(options || {}) }));
    safeHandle('mcbot:shell:project', () => openPathChecked(runtimeDir));
    safeHandle('mcbot:shell:logs', () => openPathChecked(path.join(runtimeDir, 'data', 'logs')));
    safeHandle('mcbot:shell:backups', () => openPathChecked(path.join(runtimeDir, 'data', 'backups')));
    safeHandle('mcbot:shell:support', () => openPathChecked(path.join(runtimeDir, 'data', 'support')));
}

function usableWindowBounds(savedBounds) {
    if (!savedBounds) return null;
    const visible = screen.getAllDisplays().some(display => {
        const area = display.workArea;
        const overlapWidth = Math.max(0, Math.min(savedBounds.x + savedBounds.width, area.x + area.width) - Math.max(savedBounds.x, area.x));
        const overlapHeight = Math.max(0, Math.min(savedBounds.y + savedBounds.height, area.y + area.height) - Math.max(savedBounds.y, area.y));
        return overlapWidth >= 160 && overlapHeight >= 120;
    });
    return visible ? savedBounds : null;
}

async function persistWindowStateNow() {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMaximized()) return null;
    return preferenceStore?.update({ windowBounds: mainWindow.getBounds(), windowMaximized: false }) || null;
}

function persistWindowStateSoon() {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMaximized()) return;
    clearTimeout(windowStateTimer);
    windowStateTimer = setTimeout(() => {
        windowStateTimer = null;
        persistWindowStateNow().catch(error => reportDesktopFailure(error, 'window-state-persist'));
    }, 250);
    windowStateTimer.unref?.();
}

function createWindow() {
    const savedBounds = usableWindowBounds(preferenceStore?.get('windowBounds'));
    mainWindow = new BrowserWindow({
        ...(savedBounds || { width: 1460, height: 920 }),
        minWidth: 1080,
        minHeight: 700,
        show: false,
        backgroundColor: '#0b1020',
        title: 'MCbot Desktop',
        autoHideMenuBar: true,
        icon: path.join(templateRoot, 'assets', 'mcbot.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', event => event.preventDefault());
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        notify('MCbot Desktop', `Giao diện đã dừng: ${details.reason}`, 'renderer-gone');
        const now = Date.now();
        if (now - rendererRecovery.startedAt > 60000) rendererRecovery = { startedAt: now, count: 0 };
        rendererRecovery.count += 1;
        try { crashMarkerStore.record(Object.assign(new Error(`Renderer stopped: ${details.reason}`), { code: 'DESKTOP_RENDERER_GONE' }), 'renderer-gone'); } catch (error) { reportDesktopFailure(error, 'renderer-crash-marker'); }
        if (rendererRecovery.count === 1 && mainWindow && !mainWindow.isDestroyed()) {
            setTimeout(() => mainWindow?.webContents?.reload?.(), 250).unref?.();
        }
    });
    mainWindow.on('unresponsive', () => notify('MCbot Desktop', 'Giao diện đang không phản hồi.', 'renderer-unresponsive'));
    mainWindow.on('close', event => {
        if (quitting || preferenceStore?.get('closeToTray') === false) return;
        event.preventDefault();
        mainWindow.hide();
    });
    mainWindow.on('show', () => publishSnapshot());
    mainWindow.on('resize', persistWindowStateSoon);
    mainWindow.on('move', persistWindowStateSoon);
    mainWindow.on('maximize', () => preferenceStore?.set('windowMaximized', true).catch(error => reportDesktopFailure(error, 'window-maximized-persist')));
    mainWindow.on('unmaximize', () => { preferenceStore?.set('windowMaximized', false).catch(error => reportDesktopFailure(error, 'window-unmaximized-persist')); persistWindowStateSoon(); });
    mainWindow.on('closed', () => { clearTimeout(windowStateTimer); windowStateTimer = null; mainWindow = null; });
    mainWindow.once('ready-to-show', () => {
        if (preferenceStore?.get('windowMaximized')) mainWindow?.maximize();
        if (!launchedHidden) mainWindow?.show();
    });
    mainWindow.loadFile(rendererFile);
}

function createTray() {
    if (tray || !fs.existsSync(trayIcon)) return;
    tray = new Tray(trayIcon);
    tray.setToolTip('MCbot Desktop');
    tray.on('click', () => showMainWindow());
    updateTray();
}

function updateTray() {
    if (!tray || tray.isDestroyed()) return;
    const snapshot = lastSnapshot || controller?.snapshot?.() || { lifecycle: 'STOPPED', bots: [] };
    const bots = snapshot.bots || [];
    const connected = bots.filter(bot => bot.connectionOnline === true).length;
    const modes = bots.filter(bot => bot.modeOwner).length;
    tray.setToolTip(`MCbot Desktop · ${snapshot.lifecycle} · ${connected}/${bots.length} connected · ${modes} mode`);
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Mở MCbot', click: () => showMainWindow() },
        { label: `Backend: ${snapshot.lifecycle}`, enabled: false },
        { type: 'separator' },
        { label: 'Start backend', enabled: snapshot.lifecycle !== 'RUNNING' && snapshot.lifecycle !== 'STARTING', click: () => controller.start().then(publishSnapshot).catch(error => notify('Backend start failed', error.message, 'backend-start')) },
        { label: 'Stop backend', enabled: snapshot.lifecycle === 'RUNNING', click: () => controller.stop('Stopped from system tray.').then(publishSnapshot).catch(error => notify('Backend stop failed', error.message, 'backend-stop')) },
        { type: 'separator' },
        { label: 'Thoát hoàn toàn', click: () => app.quit() }
    ]));
}

function updatePowerBlocker(snapshot = lastSnapshot) {
    const shouldBlock = preferenceStore?.get('preventSystemSleepWhileActive') !== false
        && snapshot?.lifecycle === 'RUNNING'
        && (snapshot?.bots || []).some(bot => bot.connectionOnline === true || bot.modeOwner);
    if (shouldBlock && powerBlockerId === null) {
        powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    } else if (!shouldBlock && powerBlockerId !== null) {
        powerSaveBlocker.stop(powerBlockerId);
        powerBlockerId = null;
    }
}

function notify(title, body, dedupeKey = `${title}:${body}`) {
    if (preferenceStore?.get('notifyErrors') === false || !Notification.isSupported()) return;
    const now = Date.now();
    const previous = notificationHistory.get(dedupeKey) || 0;
    if (now - previous < 30000) return;
    notificationHistory.set(dedupeKey, now);
    const notification = new Notification({ title, body: String(body || '').slice(0, 240), silent: false });
    notification.on('click', () => showMainWindow());
    notification.show();
}

function publishSnapshot() {
    if (!controller) return null;
    const snapshot = controller.snapshot();
    lastSnapshot = snapshot;
    updateTray();
    updatePowerBlocker(snapshot);
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
        mainWindow.webContents.send('mcbot:snapshot', snapshot);
        operatorSnapshotDelivery?.offer?.(controller.operatorSnapshot());
    }
    return snapshot;
}

function scheduleSnapshotLoop(reset = false) {
    if (reset && snapshotTimer) clearTimeout(snapshotTimer);
    if (snapshotTimer && !reset) return;
    const tick = () => {
        snapshotTimer = null;
        try { publishSnapshot(); } catch (error) { reportDesktopFailure(error, 'snapshot-loop'); }
        const configured = Number(preferenceStore?.get('snapshotIntervalMs') || 900);
        const interval = mainWindow?.isVisible?.() ? configured : Math.max(2500, configured);
        snapshotTimer = setTimeout(tick, interval);
        snapshotTimer.unref?.();
    };
    snapshotTimer = setTimeout(tick, 50);
    snapshotTimer.unref?.();
}

if (hasSingleInstanceLock) {
    app.on('second-instance', () => showMainWindow());

    app.whenReady().then(async () => {
        runtimeBootstrap = new DesktopRuntimeBootstrap({
            templateRoot,
            userDataRoot: app.getPath('userData'),
            isPackaged: app.isPackaged,
            appVersion: app.getVersion(),
            safeStorage
        });
        const preparedRuntime = await runtimeBootstrap.prepare();
        runtimeDir = preparedRuntime.runtimeRoot;
        runtimeMigrator = preparedRuntime.migrator;
        secretStore = preparedRuntime.secretStore;
        if (preparedRuntime.migrationReport?.warnings?.length) console.warn('[MCbot migration] Cấu hình có cảnh báo khi migration:', preparedRuntime.migrationReport.warnings);
        preferenceStore = new DesktopPreferenceStore({ filePath: path.join(app.getPath('userData'), 'preferences.json') });
        await preferenceStore.load();
        applyLoginItemSetting(preferenceStore.get('launchAtLogin'));
        localUpdateService = new LocalZipUpdateService({
            currentVersion: app.getVersion(),
            applicationRoot: templateRoot,
            userDataRoot: app.getPath('userData')
        });
        const incidentIndexStore = new IncidentIndexStore({ filePath: path.join(app.getPath('userData'), 'incidents.json') });
        controller = new DesktopController({ baseDir: runtimeDir, environment: preparedRuntime.environment, incidentIndexStore, appVersion: app.getVersion() });
        readinessService = new DesktopReadinessService({
            baseDir: runtimeDir,
            controllerProvider: () => controller,
            secretStoreProvider: () => secretStore,
            versionProvider: () => app.getVersion(),
            runtimeProvenanceProvider: () => preparedRuntime.provenanceService.sample()
        });
        operatorSnapshotDelivery = new SnapshotDeliveryCoordinator({
            send: snapshot => {
                if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) mainWindow.webContents.send('mcbot:operator-snapshot', snapshot);
            }
        });
        aiService = new LocalAiService({ controllerProvider: () => controller });
        registerIpc();
        controller.onLog(record => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mcbot:log', record);
            if (record?.level === 'error') notify('MCbot error', `${record.scope || 'Application'}: ${record.message || 'Unknown error'}`, `${record.scope}:${record.message}`);
        });
        createTray();
        createWindow();
        powerMonitor.on('resume', () => {
            if (controller?.lifecycle !== 'RUNNING') return;
            controller.reconcileFleet('desktop-system-resume').catch(error => notify('MCbot resume recovery', error.message, 'resume-reconcile'));
            setTimeout(() => publishSnapshot(), 1200).unref?.();
        });
        powerMonitor.on('suspend', () => {
            if (controller?.lifecycle === 'RUNNING') notify('MCbot Desktop', 'Hệ thống đang chuyển sang trạng thái suspend.', 'system-suspend');
        });
        scheduleSnapshotLoop();
        if (preferenceStore.get('startBackendOnLaunch')) {
            try { await controller.start(); } catch (error) { reportDesktopFailure(error, 'backend-autostart'); }
            publishSnapshot();
        }
        app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else showMainWindow(); });
    }).catch(error => fatalRecovery.handle(error, 'desktop-bootstrap'));
}

app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    runDesktopShutdownSequence({
        cleanupSchedulers: () => {
            if (snapshotTimer) { clearTimeout(snapshotTimer); snapshotTimer = null; }
            if (windowStateTimer) { clearTimeout(windowStateTimer); windowStateTimer = null; }
            if (powerBlockerId !== null) { powerSaveBlocker.stop(powerBlockerId); powerBlockerId = null; }
        },
        persistWindowState: () => persistWindowStateNow(),
        drainPreferences: () => preferenceStore?.drain?.(),
        stopController: () => controller?.stop?.('Electron application is quitting.'),
        reportFailure: reportDesktopFailure
    }).finally(() => app.quit());
});

app.on('window-all-closed', () => {
    if (quitting || preferenceStore?.get('closeToTray') === false) app.quit();
});
