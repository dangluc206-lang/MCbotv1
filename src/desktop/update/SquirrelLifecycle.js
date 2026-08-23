'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

function spawnDetached(command, args, spawnImpl = spawn) {
    try {
        const child = spawnImpl(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
        child?.unref?.();
        return true;
    } catch {
        return false;
    }
}

function handleSquirrelLifecycle({ app, argv = process.argv, execPath = process.execPath, spawnImpl = spawn, platform = process.platform, setTimeoutImpl = setTimeout } = {}) {
    if (platform !== 'win32' || !app) return false;
    const pathApi = platform === 'win32' ? path.win32 : path;
    const event = argv[1];
    if (!event || !event.startsWith('--squirrel-')) return false;
    const appFolder = pathApi.dirname(execPath);
    const rootFolder = pathApi.resolve(appFolder, '..');
    const updateExe = pathApi.join(rootFolder, 'Update.exe');
    const exeName = pathApi.basename(execPath);

    if (event === '--squirrel-install' || event === '--squirrel-updated') {
        spawnDetached(updateExe, ['--createShortcut', exeName], spawnImpl);
        setTimeoutImpl(() => app.quit(), 800).unref?.();
        return true;
    }
    if (event === '--squirrel-uninstall') {
        spawnDetached(updateExe, ['--removeShortcut', exeName], spawnImpl);
        setTimeoutImpl(() => app.quit(), 800).unref?.();
        return true;
    }
    if (event === '--squirrel-obsolete') {
        app.quit();
        return true;
    }
    return false;
}

module.exports = { handleSquirrelLifecycle };
