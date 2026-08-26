'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const electronExecutable = require('electron');
const ConfigSpecs = require('../../../src/configuration/ConfigSpecs');
const packageJson = require('../../../package.json');

const projectRoot = path.resolve(__dirname, '..', '..', '..');
const resultPrefix = 'MCBOT_E2E_RESULT:';

function prepareFixture(root) {
    for (const spec of ConfigSpecs) {
        const source = path.join(projectRoot, spec.file);
        const target = path.join(root, spec.file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
    }
    fs.writeFileSync(path.join(root, 'fixture-profile.json'), JSON.stringify({
        id: 'e2e-bot', displayName: 'E2E Bot', username: 'pseudonymous-e2e', auth: 'offline',
        version: '1.21.4', serverProfile: 'test', skyblockSelection: 'sky1', enabled: true
    }, null, 2));
}

function runHarness({ fixtureRoot, artifactRoot }) {
    return new Promise((resolve, reject) => {
        const child = spawn(electronExecutable, [
            '--disable-gpu',
            '--disable-gpu-compositing',
            // CI/desktop fixture only: this Windows host cannot boot Electron's
            // GPU/OS-crypt subprocess in its sandbox. Production BrowserWindow
            // still declares sandbox:true and never receives this CLI flag.
            '--no-sandbox',
            path.join(__dirname, 'support', 'DesktopElectronHarness.js')
        ], {
            cwd: projectRoot,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true', MCBOT_E2E_FIXTURE_ROOT: fixtureRoot, MCBOT_E2E_ARTIFACT_ROOT: artifactRoot }
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = callback => value => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            callback(value);
        };
        const timeout = setTimeout(() => {
            child.kill();
            finish(reject)(new Error(`Electron E2E timed out. stdout=${stdout}\nstderr=${stderr}`));
        }, 20000);
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.once('error', finish(reject));
        child.once('exit', code => {
            const line = stdout.split(/\r?\n/).find(value => value.startsWith(resultPrefix));
            if (!line) return finish(reject)(new Error(`Electron E2E produced no result. exit=${code}\nstdout=${stdout}\nstderr=${stderr}`));
            const result = JSON.parse(line.slice(resultPrefix.length));
            if (code !== 0 || !result.ok) return finish(reject)(new Error(`Electron E2E failed. exit=${code}\nresult=${JSON.stringify(result)}\nstderr=${stderr}`));
            finish(resolve)(result);
        });
    });
}

test('Desktop critical flow is deterministic without network or secrets', { timeout: 30000 }, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-desktop-e2e-'));
    const fixtureRoot = path.join(root, 'fixture');
    const artifactRoot = path.join(root, 'artifacts');
    fs.mkdirSync(fixtureRoot, { recursive: true });
    fs.mkdirSync(artifactRoot, { recursive: true });
    prepareFixture(fixtureRoot);
    let succeeded = false;
    t.after(() => {
        if (succeeded) fs.rmSync(root, { recursive: true, force: true });
        else process.stderr.write(`Desktop E2E artifacts retained at ${artifactRoot}\n`);
    });
    const result = await runHarness({ fixtureRoot, artifactRoot });
    assert.equal(result.lifecycle, 'STOPPED');
    assert.equal(result.initialBanner, true);
    assert.equal(result.staleVisible, true);
    assert.deepEqual(result.rendererErrors, []);
    assert.deepEqual(result.consoleErrors, []);
    assert.deepEqual(result.accessibility.failures, []);
    assert.ok(result.accessibility.interactiveCount >= 40);
    assert.equal(result.visualLayout.contract, 'desktop-visual-layout-v1');
    assert.equal(result.visualLayout.navGroups, 4);
    assert.ok(result.visualLayout.pages >= 10);
    assert.equal(result.visualLayout.horizontalOverflow, false);
    assert.equal(result.fixtureVersion, packageJson.version);
    assert.ok(fs.statSync(result.screenshotPath).size > 1000);
    succeeded = true;
});
