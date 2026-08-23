'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createForgeIgnore } = require('./ForgePackagingPolicy');

function collectIncludedFiles(baseDir, ignore = createForgeIgnore({ baseDir })) {
    const root = path.resolve(baseDir);
    const files = [];
    const directories = new Set();

    function walk(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const absolute = path.join(directory, entry.name);
            if (ignore(absolute)) continue;
            const relative = path.relative(root, absolute);
            if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
            if (entry.isDirectory()) {
                directories.add(relative);
                walk(absolute);
            } else if (entry.isFile()) {
                directories.add(path.dirname(relative));
                files.push(relative);
            } else if (entry.isSymbolicLink()) {
                const stat = fs.statSync(absolute);
                if (stat.isDirectory()) {
                    directories.add(relative);
                    walk(absolute);
                } else if (stat.isFile()) {
                    directories.add(path.dirname(relative));
                    files.push(relative);
                }
            }
        }
    }

    walk(root);
    return { files, directories: [...directories].filter(value => value && value !== '.') };
}

async function copyFilesBatched(baseDir, destination, relativeFiles, { concurrency = 48, onProgress = null } = {}) {
    const root = path.resolve(baseDir);
    const targetRoot = path.resolve(destination);
    const directories = new Set(relativeFiles.map(relative => path.dirname(relative)).filter(value => value && value !== '.'));
    for (const directory of directories) fs.mkdirSync(path.join(targetRoot, directory), { recursive: true });

    let copied = 0;
    const total = relativeFiles.length;
    for (let index = 0; index < total; index += concurrency) {
        const batch = relativeFiles.slice(index, index + concurrency);
        await Promise.all(batch.map(relative => fs.promises.copyFile(path.join(root, relative), path.join(targetRoot, relative))));
        copied += batch.length;
        onProgress?.({ copied, total });
    }
}

function cleanPackagedManifest(appDirectory) {
    const manifestPath = path.join(appDirectory, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    delete manifest.devDependencies;
    delete manifest.scripts;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
}

async function prepareWindowsPackage({
    baseDir,
    electronDist,
    outDir,
    appName = 'MCbot',
    ignore = createForgeIgnore({ baseDir }),
    onProgress = null
}) {
    const root = path.resolve(baseDir);
    const runtime = path.resolve(electronDist);
    const packageDir = path.join(path.resolve(outDir), `${appName}-win32-x64`);
    const sourceExe = path.join(runtime, 'electron.exe');
    if (!fs.existsSync(sourceExe)) throw new Error(`Electron Windows runtime was not found: ${sourceExe}`);

    fs.rmSync(packageDir, { recursive: true, force: true });
    fs.mkdirSync(packageDir, { recursive: true });

    onProgress?.({ phase: 'runtime-copy-start' });
    fs.cpSync(runtime, packageDir, { recursive: true, force: true });
    const electronExe = path.join(packageDir, 'electron.exe');
    const appExe = path.join(packageDir, `${appName}.exe`);
    if (!fs.existsSync(electronExe)) throw new Error('Electron runtime copy completed without electron.exe.');
    fs.renameSync(electronExe, appExe);

    const defaultApp = path.join(packageDir, 'resources', 'default_app.asar');
    fs.rmSync(defaultApp, { force: true });
    const appDirectory = path.join(packageDir, 'resources', 'app');
    fs.rmSync(appDirectory, { recursive: true, force: true });
    fs.mkdirSync(appDirectory, { recursive: true });
    onProgress?.({ phase: 'runtime-copy-complete' });

    const collected = collectIncludedFiles(root, ignore);
    onProgress?.({ phase: 'app-copy-start', total: collected.files.length });
    await copyFilesBatched(root, appDirectory, collected.files, {
        onProgress: progress => onProgress?.({ phase: 'app-copy-progress', ...progress })
    });
    const manifest = cleanPackagedManifest(appDirectory);

    const mainFile = path.join(appDirectory, manifest.main || 'index.js');
    if (!fs.existsSync(mainFile)) throw new Error(`Packaged application main entry was not found: ${mainFile}`);
    if (!fs.existsSync(appExe)) throw new Error(`Packaged executable was not found: ${appExe}`);

    onProgress?.({ phase: 'complete', packageDir, appExe, files: collected.files.length });
    return { packageDir, appExe, appDirectory, files: collected.files.length };
}

module.exports = {
    collectIncludedFiles,
    copyFilesBatched,
    cleanPackagedManifest,
    prepareWindowsPackage
};
