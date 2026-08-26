'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const build = require('../../../scripts/build-windows');
const root = path.resolve(__dirname, '..', '..', '..');

test('Windows build helper validates Electron/direct installer manifest and formats CLI flags', () => {
    const result = build.verifyManifest(root);
    assert.equal(result.required.electron, '43.4.0');
    assert.equal(result.required['electron-winstaller'], '5.4.4');
    assert.deepEqual(build.parseArgs(['--skip-gates', '--verbose', '--clean-install']), { skipGates: true, keepOut: false, verbose: true, cleanInstall: true, diagnoseDeps: false });
    assert.deepEqual(build.parseArgs(['--diagnose-deps']), { skipGates: false, keepOut: false, verbose: false, cleanInstall: false, diagnoseDeps: true });
    assert.equal(build.BUILDER_REVISION, '2.7.0-roadmap-closure');
    assert.equal(build.formatDuration(65_000), '1m 5s');
});

test('Windows build helper detects packaged MCbot executable and canonical installer path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-build-helper-'));
    fs.mkdirSync(path.join(dir, 'out', 'MCbot-win32-x64'), { recursive: true });
    const exe = path.join(dir, 'out', 'MCbot-win32-x64', 'MCbot.exe');
    fs.writeFileSync(exe, 'fake');
    assert.equal(build.findPackagedExecutable(dir), exe);
    assert.equal(build.installerPath(dir), path.join(dir, 'out', 'make', 'squirrel.windows', 'x64', 'MCbot Setup.exe'));
    fs.rmSync(dir, { recursive: true, force: true });
});

test('Windows build packaging guard is valid for both source-only and installed trees', () => {
    const stats = build.packagingInputStats(root);
    const contract = build.loadPackagingFootprintContract(root);
    const verdict = build.evaluatePackagingFootprint(stats, contract);
    // Direct-extract/source archives intentionally omit node_modules, while an
    // installed build tree contains thousands of production dependency files.
    // The guard must be meaningful in both environments: require the real app
    // payload to be present, and enforce the upper packaging safety bound.
    assert.equal(verdict.valid, true, `${verdict.failures.join(', ')}: ${stats.megabytes} MB`);
    assert.equal(contract.policy.environmentMayLowerMaximumOnly, true);
    assert.ok(verdict.maximumMegabytes >= contract.baseline.measuredMegabytes);
    assert.equal(build.evaluatePackagingFootprint(stats, contract, { requestedMaximum: 1 }).valid, false);
});

test('Windows build dependency report explains a missing Electron runtime instead of returning an opaque false', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-build-deps-'));
    const manifest = {
        dependencies: { dotenv: '^17.4.2' },
        devDependencies: {
            electron: '43.4.0',
            'electron-winstaller': '5.4.4'
        }
    };
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest));
    for (const [name, version] of [
        ['dotenv', '17.4.2'],
        ['electron', '43.4.0'],
        ['electron-winstaller', '5.4.4']
    ]) {
        const packageDir = path.join(dir, 'node_modules', ...name.split('/'));
        fs.mkdirSync(packageDir, { recursive: true });
        fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name, version }));
    }

    const report = build.dependencyReport(dir, { platform: 'win32' });
    assert.equal(report.ready, false);
    assert.equal(report.issues.length, 1);
    assert.equal(report.issues[0].type, 'electron-runtime-missing');
    assert.match(build.describeDependencyIssue(report.issues[0], dir), /Electron runtime missing/i);

    fs.mkdirSync(path.dirname(report.electronExe), { recursive: true });
    fs.writeFileSync(report.electronExe, 'fake');
    assert.equal(build.dependencyReport(dir, { platform: 'win32' }).ready, true);
    fs.rmSync(dir, { recursive: true, force: true });
});
