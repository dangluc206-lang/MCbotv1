'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createWindowsInstaller } = require('electron-winstaller');

const ROOT = path.resolve(__dirname, '..', '..');
const appDirectory = path.join(ROOT, 'out', 'MCbot-win32-x64');
const outputDirectory = path.join(ROOT, 'out', 'make', 'squirrel.windows', 'x64');
const setupIcon = path.join(ROOT, 'assets', 'mcbot.ico');

if (!fs.existsSync(path.join(appDirectory, 'MCbot.exe'))) {
    throw new Error(`Packaged MCbot.exe was not found: ${path.join(appDirectory, 'MCbot.exe')}`);
}

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.mkdirSync(outputDirectory, { recursive: true });

console.log('[INSTALLER] Creating Squirrel.Windows installer directly with electron-winstaller...');
createWindowsInstaller({
    appDirectory,
    outputDirectory,
    authors: 'MCbot',
    owners: 'MCbot',
    description: 'Desktop control application for the MCbot Mineflayer automation framework.',
    title: 'MCbot Desktop',
    name: 'mcbot_desktop',
    exe: 'MCbot.exe',
    setupExe: 'MCbot Setup.exe',
    setupIcon,
    noMsi: true
}).then(() => {
    console.log(`[INSTALLER] Installer output ready: ${path.relative(ROOT, outputDirectory)}`);
}).catch(error => {
    console.error('[INSTALLER ERROR]', error?.stack || error);
    process.exitCode = 1;
});
