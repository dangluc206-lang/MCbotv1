'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createForgeIgnore } = require('./build/ForgePackagingPolicy');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'out');
const BUILDER_REVISION = '2.6.17-round2-audit-hardening';

function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.round(Number(ms) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function parseArgs(argv = process.argv.slice(2)) {
    const set = new Set(argv);
    return {
        skipGates: set.has('--skip-gates'),
        keepOut: set.has('--keep-out'),
        verbose: set.has('--verbose') || process.env.MCBOT_BUILD_VERBOSE === '1',
        cleanInstall: set.has('--clean-install'),
        diagnoseDeps: set.has('--diagnose-deps')
    };
}

function packageManifest(baseDir = ROOT) {
    return JSON.parse(fs.readFileSync(path.join(baseDir, 'package.json'), 'utf8'));
}

function verifyManifest(baseDir = ROOT) {
    const manifest = packageManifest(baseDir);
    const dev = manifest.devDependencies || {};
    const required = {
        electron: dev.electron,
        'electron-winstaller': dev['electron-winstaller']
    };
    const missing = Object.entries(required).filter(([, version]) => !version).map(([name]) => name);
    if (missing.length) throw new Error(`Missing build devDependencies: ${missing.join(', ')}`);
    return { manifest, required };
}

function installedPackageVersion(baseDir, packageName) {
    try {
        const packageJson = path.join(baseDir, 'node_modules', ...packageName.split('/'), 'package.json');
        return JSON.parse(fs.readFileSync(packageJson, 'utf8')).version || null;
    } catch {
        return null;
    }
}

function dependencyReport(baseDir = ROOT, { platform = process.platform } = {}) {
    const { manifest, required } = verifyManifest(baseDir);
    const issues = [];
    const installed = {};

    for (const [name, wanted] of Object.entries(required)) {
        const actual = installedPackageVersion(baseDir, name);
        installed[name] = actual;
        const exactWanted = String(wanted || '').replace(/^[~^]/, '');
        if (!actual) issues.push({ type: 'package-missing', name, wanted: exactWanted });
        else if (actual !== exactWanted) issues.push({ type: 'version-mismatch', name, wanted: exactWanted, installed: actual });
    }

    for (const name of Object.keys(manifest.dependencies || {})) {
        const actual = installedPackageVersion(baseDir, name);
        installed[name] = actual;
        if (!actual) issues.push({ type: 'package-missing', name, wanted: manifest.dependencies[name] });
    }

    const electronExe = path.join(baseDir, 'node_modules', 'electron', 'dist', platform === 'win32' ? 'electron.exe' : 'electron');
    if (platform === 'win32' && installed.electron && !fs.existsSync(electronExe)) {
        issues.push({ type: 'electron-runtime-missing', path: electronExe });
    }

    return { ready: issues.length === 0, issues, installed, electronExe };
}

function dependenciesReady(baseDir = ROOT, options = {}) {
    return dependencyReport(baseDir, options).ready;
}

function describeDependencyIssue(issue, baseDir = ROOT) {
    if (!issue || typeof issue !== 'object') return String(issue || 'unknown dependency issue');
    if (issue.type === 'package-missing') return `${issue.name} is missing (wanted ${issue.wanted || 'configured version'})`;
    if (issue.type === 'version-mismatch') return `${issue.name} version mismatch (installed ${issue.installed || 'none'}, wanted ${issue.wanted})`;
    if (issue.type === 'electron-runtime-missing') return `Electron runtime missing: ${path.relative(baseDir, issue.path)}`;
    return JSON.stringify(issue);
}

function printDependencyReport(report, baseDir = ROOT, prefix = '[BUILD]') {
    if (report.ready) {
        console.log(`${prefix} Dependency preflight PASS.`);
        return;
    }
    console.error(`${prefix} Dependency preflight found ${report.issues.length} issue(s):`);
    for (const issue of report.issues) console.error(`${prefix}   - ${describeDependencyIssue(issue, baseDir)}`);
}

function findPackagedExecutable(baseDir = ROOT) {
    const executable = path.join(baseDir, 'out', 'MCbot-win32-x64', 'MCbot.exe');
    return fs.existsSync(executable) ? executable : null;
}

function installerPath(baseDir = ROOT) {
    return path.join(baseDir, 'out', 'make', 'squirrel.windows', 'x64', 'MCbot Setup.exe');
}

function packagingInputStats(baseDir = ROOT) {
    const ignore = createForgeIgnore({ baseDir });
    let files = 0;
    let bytes = 0;
    let ignoredDirectories = 0;

    function walk(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const target = path.join(directory, entry.name);
            if (ignore(target)) {
                if (entry.isDirectory()) ignoredDirectories += 1;
                continue;
            }
            if (entry.isDirectory()) walk(target);
            else if (entry.isFile()) {
                files += 1;
                bytes += fs.statSync(target).size;
            }
        }
    }

    walk(path.resolve(baseDir));
    return { files, bytes, megabytes: Math.round((bytes / 1024 / 1024) * 10) / 10, ignoredDirectories };
}

function killProcessTree(pid) {
    if (!pid) return;
    if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
        return;
    }
    try {
        process.kill(pid, 'SIGTERM');
    } catch (error) {
        if (error?.code !== 'ESRCH') console.warn(`[BUILD] Failed to stop process ${pid}: ${error?.message || error}`);
    }
}

function runCommand(label, command, args, { cwd = ROOT, env = process.env, heartbeatMs = 15000, timeoutMs = 0, shell = false } = {}) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        console.log(`\n[BUILD] ${label}`);
        if (env.MCBOT_BUILD_VERBOSE === '1') console.log(`[BUILD] ${command} ${args.join(' ')}`);
        const child = spawn(command, args, { cwd, env, stdio: 'inherit', windowsHide: false, shell });
        let timedOut = false;
        const heartbeat = heartbeatMs > 0 ? setInterval(() => {
            console.log(`[BUILD] ${label} still running | elapsed ${formatDuration(Date.now() - startedAt)} | pid ${child.pid || '?'}`);
        }, heartbeatMs) : null;
        heartbeat?.unref?.();
        const timeout = timeoutMs > 0 ? setTimeout(() => {
            timedOut = true;
            console.error(`[BUILD] ${label} exceeded ${formatDuration(timeoutMs)}; stopping the process tree.`);
            killProcessTree(child.pid);
        }, timeoutMs) : null;
        timeout?.unref?.();

        child.once('error', error => {
            if (heartbeat) clearInterval(heartbeat);
            if (timeout) clearTimeout(timeout);
            reject(error);
        });
        child.once('exit', code => {
            if (heartbeat) clearInterval(heartbeat);
            if (timeout) clearTimeout(timeout);
            const elapsed = formatDuration(Date.now() - startedAt);
            if (timedOut) return reject(new Error(`${label} timed out after ${elapsed}.`));
            if (code !== 0) return reject(new Error(`${label} failed with exit code ${code}.`));
            console.log(`[BUILD] ${label} completed in ${elapsed}.`);
            resolve({ code, elapsed });
        });
    });
}

function runNpm(label, args, options = {}) {
    return runCommand(label, 'npm', args, { ...options, shell: process.platform === 'win32' });
}

function installEnvironment() {
    const env = { ...process.env, npm_config_ignore_scripts: 'false' };
    env.ELECTRON_INSTALL_PLATFORM = 'win32';
    env.ELECTRON_INSTALL_ARCH = 'x64';
    delete env.ELECTRON_OVERRIDE_DIST_PATH;
    return env;
}

async function repairElectronRuntime() {
    const installScript = path.join(ROOT, 'node_modules', 'electron', 'install.js');
    if (!fs.existsSync(installScript)) return false;
    console.log('[BUILD] Electron npm package exists but its Windows runtime is missing.');
    console.log('[BUILD] Running Electron postinstall repair for win32/x64...');
    await runCommand('Repair Electron runtime', process.execPath, [installScript], {
        env: installEnvironment(),
        heartbeatMs: 15000,
        timeoutMs: 10 * 60 * 1000
    });
    return true;
}

async function ensureDependencies(forceClean = false) {
    let report = dependencyReport(ROOT, { platform: 'win32' });
    if (!forceClean && report.ready) {
        console.log('[BUILD] Dependencies already match package.json/package-lock.json; skipping npm install.');
        return;
    }

    if (!forceClean) printDependencyReport(report, ROOT);
    console.log('[BUILD] Installing a clean dependency tree with npm ci...');
    await runNpm('npm ci', ['ci', '--no-audit', '--no-fund'], {
        env: installEnvironment(),
        heartbeatMs: 15000,
        timeoutMs: 15 * 60 * 1000
    });

    report = dependencyReport(ROOT, { platform: 'win32' });
    if (report.issues.length > 0 && report.issues.every(issue => issue.type === 'electron-runtime-missing')) {
        await repairElectronRuntime();
        report = dependencyReport(ROOT, { platform: 'win32' });
    }

    if (!report.ready) {
        printDependencyReport(report, ROOT, '[BUILD ERROR]');
        throw new Error(`Dependency preflight failed after npm ci (${BUILDER_REVISION}); see the exact issue(s) above.`);
    }
    console.log('[BUILD] Dependency preflight PASS after npm ci.');
}

async function main() {
    if (process.platform !== 'win32') throw new Error('MCbot Setup.exe must be built on Windows.');
    const major = Number(process.versions.node.split('.')[0]);
    if (!Number.isInteger(major) || major < 22) throw new Error(`Node.js 22+ is required. Current: ${process.version}`);

    const options = parseArgs();
    const startedAt = Date.now();
    const { manifest, required } = verifyManifest(ROOT);
    console.log('==========================================');
    console.log(` MCbot Desktop ${manifest.version} Windows Builder`);
    console.log(` [BUILD] Builder revision: ${BUILDER_REVISION}`);
    console.log('==========================================');
    console.log(`[BUILD] Node ${process.version} | ${process.arch}`);
    console.log(`[BUILD] Electron ${required.electron} | electron-winstaller ${required['electron-winstaller']}`);
    console.log('[BUILD] Packaging engine: DIRECT (Forge package/rebuild is not used).');

    if (options.diagnoseDeps) {
        const report = dependencyReport(ROOT, { platform: 'win32' });
        printDependencyReport(report, ROOT, report.ready ? '[BUILD]' : '[BUILD ERROR]');
        if (report.ready) console.log('[BUILD] Dependency diagnostic PASS.');
        process.exitCode = report.ready ? 0 : 2;
        return;
    }

    await ensureDependencies(options.cleanInstall);
    await runNpm('Audited stale cleanup', ['run', 'cleanup:stale'], { timeoutMs: 2 * 60 * 1000 });

    if (!options.skipGates) {
        await runNpm('Architecture/config validation', ['run', 'validate'], { timeoutMs: 5 * 60 * 1000 });
        await runNpm('Test + coverage gate', ['run', 'test:coverage'], { timeoutMs: 10 * 60 * 1000 });
    } else {
        console.log('[BUILD] --skip-gates selected; validation/tests were not run by this build command.');
    }

    if (!options.keepOut) {
        fs.rmSync(OUT_DIR, { recursive: true, force: true });
        console.log('[BUILD] Removed previous out/ directory.');
    }

    const packageInput = packagingInputStats(ROOT);
    console.log(`[BUILD] Direct package input: ${packageInput.megabytes} MB | ${packageInput.files} files | ${packageInput.ignoredDirectories} directories skipped.`);
    const maxPackagingInputMb = Number(process.env.MCBOT_MAX_PACKAGE_INPUT_MB) || 300;
    if (packageInput.megabytes > maxPackagingInputMb) {
        throw new Error(`Packaging input is unexpectedly large (${packageInput.megabytes} MB > ${maxPackagingInputMb} MB). The filter may be ineffective.`);
    }

    const buildEnv = { ...process.env };
    if (options.verbose) {
        buildEnv.MCBOT_BUILD_VERBOSE = '1';
        buildEnv.DEBUG = [buildEnv.DEBUG, 'electron-windows-installer*'].filter(Boolean).join(',');
    }

    console.log('[BUILD] Direct packaging bypasses Electron Forge and native dependency rebuild entirely.');
    await runCommand('Direct package MCbot.exe', process.execPath, [path.join(ROOT, 'scripts', 'build', 'package-windows-direct.js')], {
        env: buildEnv,
        heartbeatMs: 15000,
        timeoutMs: Number(process.env.MCBOT_PACKAGE_TIMEOUT_MS) || 8 * 60 * 1000
    });

    const packagedExe = findPackagedExecutable(ROOT);
    if (!packagedExe) throw new Error('Direct package reported success but out/MCbot-win32-x64/MCbot.exe was not found.');
    console.log(`[BUILD] Packaged executable verified: ${path.relative(ROOT, packagedExe)}`);

    await runCommand('Create Squirrel.Windows installer', process.execPath, [path.join(ROOT, 'scripts', 'build', 'make-windows-installer.js')], {
        env: buildEnv,
        heartbeatMs: 15000,
        timeoutMs: Number(process.env.MCBOT_MAKE_TIMEOUT_MS) || 12 * 60 * 1000
    });

    const installer = installerPath(ROOT);
    if (!fs.existsSync(installer)) throw new Error('electron-winstaller reported success but MCbot Setup.exe was not found.');
    console.log('\n==========================================');
    console.log(' BUILD COMPLETE');
    console.log(` Installer: ${path.relative(ROOT, installer)}`);
    console.log(` Total time: ${formatDuration(Date.now() - startedAt)}`);
    console.log('==========================================');
}

if (require.main === module) {
    main().catch(error => {
        console.error('\n[BUILD ERROR]', error?.message || error);
        console.error('[BUILD ERROR] Re-run with: node scripts\\build-windows.js --verbose');
        process.exitCode = 1;
    });
}

module.exports = {
    BUILDER_REVISION,
    dependenciesReady,
    dependencyReport,
    describeDependencyIssue,
    findPackagedExecutable,
    formatDuration,
    installerPath,
    packagingInputStats,
    packageManifest,
    parseArgs,
    runNpm,
    verifyManifest
};
