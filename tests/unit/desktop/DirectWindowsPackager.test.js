'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    collectIncludedFiles,
    prepareWindowsPackage
} = require('../../../scripts/build/DirectWindowsPackager');

test('Direct Windows packager copies Electron runtime and filtered application without Forge', async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-direct-package-'));
    const project = path.join(temp, 'project');
    const electronDist = path.join(temp, 'electron-dist');
    const out = path.join(project, 'out');
    fs.mkdirSync(path.join(project, 'src'), { recursive: true });
    fs.mkdirSync(path.join(project, 'tests'), { recursive: true });
    fs.mkdirSync(path.join(electronDist, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', main: 'src/main.js', scripts: { test: 'x' }, devDependencies: { electron: 'x' } }));
    fs.writeFileSync(path.join(project, 'src', 'main.js'), 'module.exports = 1;');
    fs.writeFileSync(path.join(project, 'tests', 'should-not-ship.js'), 'bad');
    fs.writeFileSync(path.join(electronDist, 'electron.exe'), 'electron-runtime');
    fs.writeFileSync(path.join(electronDist, 'resources', 'default_app.asar'), 'default');

    const ignore = candidate => path.relative(project, candidate).replace(/\\/g, '/').startsWith('tests/');
    const collected = collectIncludedFiles(project, ignore);
    assert.ok(collected.files.includes('src/main.js'));
    assert.ok(!collected.files.includes('tests/should-not-ship.js'));

    const result = await prepareWindowsPackage({ baseDir: project, electronDist, outDir: out, appName: 'MCbot', ignore });
    assert.ok(fs.existsSync(result.appExe));
    assert.equal(fs.existsSync(path.join(result.packageDir, 'electron.exe')), false);
    assert.equal(fs.existsSync(path.join(result.packageDir, 'resources', 'default_app.asar')), false);
    assert.ok(fs.existsSync(path.join(result.appDirectory, 'src', 'main.js')));
    assert.equal(fs.existsSync(path.join(result.appDirectory, 'tests', 'should-not-ship.js')), false);

    const packagedManifest = JSON.parse(fs.readFileSync(path.join(result.appDirectory, 'package.json'), 'utf8'));
    assert.equal(packagedManifest.devDependencies, undefined);
    assert.equal(packagedManifest.scripts, undefined);
    fs.rmSync(temp, { recursive: true, force: true });
});
