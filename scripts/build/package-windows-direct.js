'use strict';

const path = require('node:path');
const { prepareWindowsPackage } = require('./DirectWindowsPackager');

const ROOT = path.resolve(__dirname, '..', '..');
const electronDist = path.join(ROOT, 'node_modules', 'electron', 'dist');
const outDir = path.join(ROOT, 'out');
let lastPercent = -1;

prepareWindowsPackage({
    baseDir: ROOT,
    electronDist,
    outDir,
    appName: 'MCbot',
    onProgress(event) {
        if (event.phase === 'runtime-copy-start') console.log('[DIRECT PACKAGE] Copying Electron Windows runtime...');
        else if (event.phase === 'runtime-copy-complete') console.log('[DIRECT PACKAGE] Electron runtime copied.');
        else if (event.phase === 'app-copy-start') console.log(`[DIRECT PACKAGE] Copying ${event.total} production files...`);
        else if (event.phase === 'app-copy-progress') {
            const percent = event.total ? Math.floor((event.copied / event.total) * 100) : 100;
            if (percent >= lastPercent + 5 || event.copied === event.total) {
                lastPercent = percent;
                console.log(`[DIRECT PACKAGE] App files ${event.copied}/${event.total} (${percent}%).`);
            }
        } else if (event.phase === 'complete') {
            console.log(`[DIRECT PACKAGE] MCbot.exe ready: ${path.relative(ROOT, event.appExe)}`);
        }
    }
}).catch(error => {
    console.error('[DIRECT PACKAGE ERROR]', error?.stack || error);
    process.exitCode = 1;
});
