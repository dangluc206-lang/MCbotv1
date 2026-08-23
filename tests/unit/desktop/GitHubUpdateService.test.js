'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const GitHubUpdateService = require('../../../src/desktop/update/GitHubUpdateService');

function response(statusCode, body, headers = {}) {
    const stream = Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(String(body))]);
    stream.statusCode = statusCode;
    stream.headers = headers;
    return stream;
}

function fakeHttps(routes) {
    return {
        request(target, _options, callback) {
            const listeners = new Map();
            return {
                setTimeout() {},
                once(name, listener) { listeners.set(name, listener); return this; },
                end() {
                    queueMicrotask(() => {
                        try {
                            const route = routes.find(entry => entry.match(target));
                            if (!route) throw new Error(`No fake route for ${target.href}`);
                            callback(route.response(target));
                        } catch (error) {
                            listeners.get('error')?.(error);
                        }
                    });
                }
            };
        }
    };
}

test('GitHubUpdateService selects newest stable setup asset and verifies SHA-256 download', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-update-'));
    const payload = Buffer.from('fake setup bytes');
    const digest = `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`;
    const releases = [
        { tag_name: 'v2.5.0-beta.1', prerelease: true, draft: false, assets: [{ name: 'MCbot Setup.exe', browser_download_url: 'https://github.com/example/repo/releases/download/v2.5.0-beta.1/setup.exe', size: payload.length, digest }] },
        { tag_name: 'v2.4.0', prerelease: false, draft: false, name: '2.4 stable', body: 'notes', html_url: 'https://github.com/example/repo/releases/tag/v2.4.0', assets: [{ name: 'MCbot Setup.exe', browser_download_url: 'https://github.com/example/repo/releases/download/v2.4.0/setup.exe', size: payload.length, digest }] }
    ];
    const httpsModule = fakeHttps([
        { match: url => url.hostname === 'api.github.com', response: () => response(200, JSON.stringify(releases)) },
        { match: url => url.hostname === 'github.com', response: () => response(200, payload, { 'content-length': String(payload.length) }) }
    ]);
    const service = new GitHubUpdateService({ currentVersion: '2.3.0', repository: 'example/repo', updatesDir: dir, httpsModule });
    const checked = await service.check();
    assert.equal(checked.available, true);
    assert.equal(checked.release.version, '2.4.0');
    const downloaded = await service.download();
    assert.equal(downloaded.downloaded, true);
    assert.equal(fs.readFileSync(downloaded.downloadedPath).toString(), payload.toString());
    fs.rmSync(dir, { recursive: true, force: true });
});

test('GitHubUpdateService reports up-to-date when no newer compatible release exists', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-update-current-'));
    const releases = [{ tag_name: 'v2.3.0', prerelease: false, draft: false, assets: [{ name: 'MCbot Setup.exe', browser_download_url: 'https://github.com/example/repo/x.exe', size: 1 }] }];
    const service = new GitHubUpdateService({
        currentVersion: '2.3.0', repository: 'example/repo', updatesDir: dir,
        httpsModule: fakeHttps([{ match: url => url.hostname === 'api.github.com', response: () => response(200, JSON.stringify(releases)) }])
    });
    const checked = await service.check();
    assert.equal(checked.available, false);
    assert.equal(checked.phase, 'UP_TO_DATE');
    fs.rmSync(dir, { recursive: true, force: true });
});


test('GitHubUpdateService rejects repository changes when an official source is locked', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-update-trust-'));
    const service = new GitHubUpdateService({
        currentVersion: '2.4.0',
        repository: 'example/repo',
        trustedRepository: 'example/repo',
        updatesDir: dir,
        httpsModule: fakeHttps([])
    });
    assert.throws(() => service.configure({ repository: 'evil/project' }), error => error?.code === 'UPDATE_REPOSITORY_UNTRUSTED');
    fs.rmSync(dir, { recursive: true, force: true });
});


test('GitHubUpdateService exposes best-effort cleanup failure in status instead of swallowing it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-update-cleanup-warning-'));
    const payload = Buffer.from('setup');
    const digest = `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`;
    const releases = [{
        tag_name: 'v2.4.0', prerelease: false, draft: false,
        assets: [{ name: 'MCbot Setup.exe', browser_download_url: 'https://github.com/example/repo/setup.exe', size: payload.length, digest }]
    }];
    let cleanupCalls = 0;
    const service = new GitHubUpdateService({
        currentVersion: '2.3.0', repository: 'example/repo', updatesDir: dir,
        httpsModule: fakeHttps([
            { match: url => url.hostname === 'api.github.com', response: () => response(200, JSON.stringify(releases)) },
            { match: url => url.hostname === 'github.com', response: () => response(200, payload, { 'content-length': String(payload.length) }) }
        ]),
        removePath: async () => { cleanupCalls += 1; const error = new Error('locked'); error.code = 'EBUSY'; throw error; }
    });
    try {
        await service.check();
        await service.download();
        const status = await service.clearDownloaded();
        assert.equal(cleanupCalls, 1);
        assert.equal(status.downloadedPath, null);
        assert.equal(status.cleanupWarning.code, 'EBUSY');
        assert.equal(status.cleanupWarning.reason, 'clear-downloaded');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GitHubUpdateService serializes concurrent download callers before any transport side effect', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-update-concurrent-'));
    const payload = Buffer.from('concurrent setup bytes');
    const digest = `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`;
    const releases = [{
        tag_name: 'v2.4.0', prerelease: false, draft: false,
        assets: [{ name: 'MCbot Setup.exe', browser_download_url: 'https://github.com/example/repo/setup-concurrent.exe', size: payload.length, digest }]
    }];
    let downloadRequests = 0;
    const service = new GitHubUpdateService({
        currentVersion: '2.3.0', repository: 'example/repo', updatesDir: dir,
        httpsModule: fakeHttps([
            { match: url => url.hostname === 'api.github.com', response: () => response(200, JSON.stringify(releases)) },
            { match: url => url.hostname === 'github.com', response: () => { downloadRequests += 1; return response(200, payload, { 'content-length': String(payload.length) }); } }
        ])
    });
    try {
        await service.check();
        const settled = await Promise.allSettled([service.download(), service.download()]);
        assert.equal(settled.filter(item => item.status === 'fulfilled').length, 1);
        assert.equal(settled.filter(item => item.status === 'rejected').length, 1);
        assert.equal(downloadRequests, 1, 'only one caller may start download transport');
        const rejection = settled.find(item => item.status === 'rejected').reason;
        assert.match(String(rejection?.message || rejection), /đang được tải|đang bận/i);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GitHubUpdateService blocks clearDownloaded while a download owns the transaction', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-update-clear-during-download-'));
    const payload = Buffer.from('download ownership bytes');
    const digest = `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`;
    const releases = [{
        tag_name: 'v2.4.0', prerelease: false, draft: false,
        assets: [{ name: 'MCbot Setup.exe', browser_download_url: 'https://github.com/example/repo/setup-owner.exe', size: payload.length, digest }]
    }];
    const service = new GitHubUpdateService({
        currentVersion: '2.3.0', repository: 'example/repo', updatesDir: dir,
        httpsModule: fakeHttps([
            { match: url => url.hostname === 'api.github.com', response: () => response(200, JSON.stringify(releases)) },
            { match: url => url.hostname === 'github.com', response: () => response(200, payload, { 'content-length': String(payload.length) }) }
        ])
    });
    try {
        await service.check();
        const downloadPromise = service.download();
        await assert.rejects(() => service.clearDownloaded(), /đang được tải|đang bận/i);
        const downloaded = await downloadPromise;
        assert.equal(downloaded.phase, 'DOWNLOADED');
        assert.equal(downloaded.downloaded, true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GitHubUpdateService invalidates checked release state when repository/channel configuration changes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-update-reconfigure-state-'));
    const releases = [{
        tag_name: 'v2.4.0', prerelease: false, draft: false,
        assets: [{ name: 'MCbot Setup.exe', browser_download_url: 'https://github.com/example/repo/stable.exe', size: 1 }]
    }];
    const service = new GitHubUpdateService({
        currentVersion: '2.3.0', repository: 'example/repo', channel: 'stable', updatesDir: dir,
        httpsModule: fakeHttps([{ match: url => url.hostname === 'api.github.com', response: () => response(200, JSON.stringify(releases)) }])
    });
    try {
        const checked = await service.check();
        assert.equal(checked.available, true);
        assert.equal(checked.release.version, '2.4.0');
        const configured = service.configure({ channel: 'beta' });
        assert.equal(configured.channel, 'beta');
        assert.equal(configured.phase, 'IDLE');
        assert.equal(configured.available, false);
        assert.equal(configured.release, null);
        assert.equal(configured.downloadedPath, null);
        assert.equal(configured.checkedAt, null);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GitHubUpdateService rejects a configuration change while a check transaction is in flight', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-update-reconfigure-busy-'));
    const releases = [{
        tag_name: 'v2.4.0', prerelease: false, draft: false,
        assets: [{ name: 'MCbot Setup.exe', browser_download_url: 'https://github.com/example/repo/stable.exe', size: 1 }]
    }];
    const service = new GitHubUpdateService({
        currentVersion: '2.3.0', repository: 'example/repo', channel: 'stable', updatesDir: dir,
        httpsModule: fakeHttps([{ match: url => url.hostname === 'api.github.com', response: () => response(200, JSON.stringify(releases)) }])
    });
    try {
        const checkPromise = service.check();
        assert.throws(() => service.configure({ channel: 'beta' }), /đang bận|đang được tải/i);
        const checked = await checkPromise;
        assert.equal(checked.channel, 'stable');
        assert.equal(checked.release.version, '2.4.0');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GitHubUpdateService re-verifies downloaded installer integrity and invalidates a tampered artifact before install', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-update-install-integrity-'));
    const payload = Buffer.from('verified setup bytes');
    const tampered = Buffer.from('tampered setup bytes');
    assert.equal(tampered.length, payload.length, 'fixture must preserve size so digest verification is exercised');
    const digest = `sha256:${crypto.createHash('sha256').update(payload).digest('hex')}`;
    const releases = [{
        tag_name: 'v2.4.0', prerelease: false, draft: false,
        assets: [{ name: 'MCbot Setup.exe', browser_download_url: 'https://github.com/example/repo/setup-integrity.exe', size: payload.length, digest }]
    }];
    const service = new GitHubUpdateService({
        currentVersion: '2.3.0', repository: 'example/repo', updatesDir: dir,
        httpsModule: fakeHttps([
            { match: url => url.hostname === 'api.github.com', response: () => response(200, JSON.stringify(releases)) },
            { match: url => url.hostname === 'github.com', response: () => response(200, payload, { 'content-length': String(payload.length) }) }
        ])
    });
    try {
        await service.check();
        const downloaded = await service.download();
        assert.equal(downloaded.downloaded, true);
        assert.equal(downloaded.downloadedIntegrity.digest, digest);
        fs.writeFileSync(downloaded.downloadedPath, tampered);

        await assert.rejects(
            () => service.verifyDownloadedArtifact(),
            error => error?.code === 'UPDATE_DOWNLOADED_DIGEST_MISMATCH'
        );
        const status = service.status();
        assert.equal(status.phase, 'ERROR');
        assert.equal(status.downloaded, false);
        assert.equal(status.downloadedPath, null);
        assert.equal(status.downloadedIntegrity, null);
        assert.equal(status.lastError.code, 'UPDATE_DOWNLOADED_DIGEST_MISMATCH');
        assert.equal(fs.existsSync(downloaded.downloadedPath), false, 'tampered installer must be removed best-effort');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('GitHubUpdateService re-verifies local download digest even when release metadata omits digest', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-update-local-integrity-'));
    const payload = Buffer.from('local digest baseline');
    const tampered = Buffer.from('local digest changed!');
    assert.equal(tampered.length, payload.length, 'fixture must preserve size');
    const releases = [{
        tag_name: 'v2.4.0', prerelease: false, draft: false,
        assets: [{ name: 'MCbot Setup.exe', browser_download_url: 'https://github.com/example/repo/setup-local-integrity.exe', size: payload.length }]
    }];
    const service = new GitHubUpdateService({
        currentVersion: '2.3.0', repository: 'example/repo', updatesDir: dir,
        httpsModule: fakeHttps([
            { match: url => url.hostname === 'api.github.com', response: () => response(200, JSON.stringify(releases)) },
            { match: url => url.hostname === 'github.com', response: () => response(200, payload, { 'content-length': String(payload.length) }) }
        ])
    });
    try {
        await service.check();
        const downloaded = await service.download();
        assert.match(downloaded.downloadedIntegrity.digest, /^sha256:[a-f0-9]{64}$/);
        fs.writeFileSync(downloaded.downloadedPath, tampered);
        await assert.rejects(() => service.verifyDownloadedArtifact(), error => error?.code === 'UPDATE_DOWNLOADED_DIGEST_MISMATCH');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
