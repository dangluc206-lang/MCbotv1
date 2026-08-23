'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const EventEmitter = require('node:events');
const { compareVersions, normalizeVersion } = require('./Version');

const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_RELEASE_BODY = 16000;
const MAX_DOWNLOAD_BYTES = 600 * 1024 * 1024;

function publicRelease(release) {
    if (!release) return null;
    return {
        version: release.version,
        tag: release.tag,
        name: release.name,
        notes: release.notes,
        publishedAt: release.publishedAt,
        prerelease: release.prerelease,
        htmlUrl: release.htmlUrl,
        asset: release.asset ? {
            name: release.asset.name,
            size: release.asset.size,
            digest: release.asset.digest || null
        } : null
    };
}

class GitHubUpdateService extends EventEmitter {
    constructor({
        currentVersion,
        repository = 'dangluc206-lang/MCbotv1',
        trustedRepository = null,
        channel = 'stable',
        updatesDir,
        httpsModule = https,
        userAgent = 'MCbot-Desktop-Updater',
        timeoutMs = 20000,
        removePath = fsp.rm
    } = {}) {
        super();
        const normalizedVersion = normalizeVersion(currentVersion);
        if (!normalizedVersion) throw new TypeError('GitHubUpdateService currentVersion không hợp lệ.');
        if (!updatesDir) throw new TypeError('GitHubUpdateService updatesDir là bắt buộc.');
        this.currentVersion = normalizedVersion;
        this.updatesDir = path.resolve(updatesDir);
        this.https = httpsModule;
        this.userAgent = userAgent;
        this.timeoutMs = Math.max(3000, Number(timeoutMs) || 20000);
        if (typeof removePath !== 'function') throw new TypeError('GitHubUpdateService removePath must be a function.');
        this.removePath = removePath;
        this.trustedRepository = trustedRepository ? String(trustedRepository).trim() : null;
        if (this.trustedRepository && !REPOSITORY_RE.test(this.trustedRepository)) throw new TypeError('Kho GitHub tin cậy không hợp lệ.');
        this.repository = null;
        this.channel = null;
        this.downloadInFlight = false;
        this.state = {
            phase: 'IDLE',
            checkedAt: null,
            available: false,
            release: null,
            downloadedPath: null,
            downloadedIntegrity: null,
            progress: null,
            lastError: null,
            cleanupWarning: null
        };
        this.configure({ repository, channel });
    }

    configure({ repository = this.repository, channel = this.channel } = {}) {
        const normalizedRepository = String(repository || '').trim();
        if (!REPOSITORY_RE.test(normalizedRepository)) throw new TypeError('Kho GitHub cập nhật phải có dạng owner/repo.');
        if (this.trustedRepository && normalizedRepository.toLowerCase() !== this.trustedRepository.toLowerCase()) {
            const error = new Error(`Nguồn cập nhật không được tin cậy: ${normalizedRepository}.`);
            error.code = 'UPDATE_REPOSITORY_UNTRUSTED';
            throw error;
        }
        const normalizedChannel = String(channel || 'stable').trim().toLowerCase();
        if (!['stable', 'beta'].includes(normalizedChannel)) throw new TypeError('Kênh cập nhật chỉ hỗ trợ stable hoặc beta.');

        const changed = this.repository !== normalizedRepository || this.channel !== normalizedChannel;
        if (!changed) return this.status();
        if (this.downloadInFlight || ['CHECKING', 'DOWNLOADING'].includes(this.state.phase)) {
            throw new Error('Hệ thống cập nhật đang bận.');
        }

        this.repository = normalizedRepository;
        this.channel = normalizedChannel;
        this.#setState({
            phase: 'IDLE',
            checkedAt: null,
            available: false,
            release: null,
            downloadedPath: null,
            downloadedIntegrity: null,
            progress: null,
            lastError: null
        });
        return this.status();
    }

    status() {
        return {
            currentVersion: this.currentVersion,
            repository: this.repository,
            channel: this.channel,
            phase: this.state.phase,
            checkedAt: this.state.checkedAt,
            available: this.state.available,
            release: publicRelease(this.state.release),
            downloaded: Boolean(this.state.downloadedPath && fs.existsSync(this.state.downloadedPath)),
            downloadedPath: this.state.downloadedPath,
            downloadedIntegrity: this.state.downloadedIntegrity ? { ...this.state.downloadedIntegrity } : null,
            progress: this.state.progress ? { ...this.state.progress } : null,
            lastError: this.state.lastError ? { ...this.state.lastError } : null,
            cleanupWarning: this.state.cleanupWarning ? { ...this.state.cleanupWarning } : null
        };
    }

    async check() {
        if (['CHECKING', 'DOWNLOADING'].includes(this.state.phase)) throw new Error('Hệ thống cập nhật đang bận.');
        this.#setState({ phase: 'CHECKING', lastError: null, progress: null });
        try {
            const releases = await this.#requestJson(`https://api.github.com/repos/${this.repository}/releases?per_page=30`);
            if (!Array.isArray(releases)) throw new Error('GitHub trả về danh sách bản phát hành không hợp lệ.');
            const release = this.#selectRelease(releases);
            const available = Boolean(release && compareVersions(release.version, this.currentVersion) > 0);
            this.#setState({
                phase: available ? 'AVAILABLE' : 'UP_TO_DATE',
                checkedAt: new Date().toISOString(),
                available,
                release: available ? release : null,
                downloadedPath: available && this.state.release?.version === release?.version ? this.state.downloadedPath : null,
                downloadedIntegrity: available && this.state.release?.version === release?.version ? this.state.downloadedIntegrity : null,
                lastError: null
            });
            return this.status();
        } catch (error) {
            this.#fail(error);
            throw error;
        }
    }

    async download() {
        if (this.downloadInFlight || this.state.phase === 'DOWNLOADING') throw new Error('Bản cập nhật đang được tải.');
        const release = this.state.release;
        if (!this.state.available || !release?.asset?.url) throw new Error('Chưa có bản cập nhật hợp lệ để tải.');

        // Acquire download ownership synchronously before the first await.
        // This prevents concurrent callers from starting duplicate transports or sharing a temp file.
        this.downloadInFlight = true;
        const versionDir = path.join(this.updatesDir, release.version);
        const finalPath = path.join(versionDir, 'MCbot Setup.exe');
        const temporaryPath = `${finalPath}.${process.pid}.${crypto.randomUUID()}.part`;
        this.#setState({
            phase: 'DOWNLOADING',
            downloadedPath: null,
            downloadedIntegrity: null,
            progress: { received: 0, total: release.asset.size || null, percent: 0 },
            lastError: null
        });
        try {
            await fsp.mkdir(versionDir, { recursive: true });

            if (await this.#verifyExisting(finalPath, release.asset)) {
                const integrity = await this.#computeFileIntegrity(finalPath);
                this.#setState({
                    phase: 'DOWNLOADED',
                    downloadedPath: finalPath,
                    downloadedIntegrity: integrity,
                    progress: { received: release.asset.size || integrity.size, total: release.asset.size || integrity.size, percent: 100 }
                });
                return this.status();
            }

            const digest = await this.#downloadFile(release.asset.url, temporaryPath, release.asset);
            if (release.asset.digest && !this.#digestMatches(release.asset.digest, digest)) {
                const error = new Error('SHA-256 của file cập nhật không khớp metadata GitHub.');
                error.code = 'UPDATE_DIGEST_MISMATCH';
                throw error;
            }
            await fsp.rename(temporaryPath, finalPath);
            const finalStat = await fsp.stat(finalPath);
            const integrity = { size: finalStat.size, digest: `sha256:${digest}` };
            this.#setState({ phase: 'DOWNLOADED', downloadedPath: finalPath, downloadedIntegrity: integrity, progress: { received: release.asset.size || finalStat.size, total: release.asset.size || null, percent: 100 } });
            return this.status();
        } catch (error) {
            await this.#cleanupPath(temporaryPath, { force: true }, 'download-failure');
            this.#fail(error);
            throw error;
        } finally {
            this.downloadInFlight = false;
        }
    }

    async verifyDownloadedArtifact() {
        if (this.downloadInFlight || this.state.phase === 'DOWNLOADING') throw new Error('Bản cập nhật đang được tải.');
        const filePath = this.state.downloadedPath;
        const release = this.state.release;
        const expected = this.state.downloadedIntegrity;
        if (!filePath || !release?.asset || !expected?.digest) {
            const error = new Error('Chưa có artifact cập nhật đã xác minh để cài đặt.');
            error.code = 'UPDATE_DOWNLOADED_ARTIFACT_NOT_READY';
            throw error;
        }

        try {
            const observed = await this.#computeFileIntegrity(filePath);
            if (release.asset.size && observed.size !== release.asset.size) {
                const error = new Error(`Kích thước installer đã thay đổi sau khi tải (${observed.size}/${release.asset.size}).`);
                error.code = 'UPDATE_DOWNLOADED_SIZE_MISMATCH';
                throw error;
            }
            if (observed.size !== expected.size || !this.#digestMatches(expected.digest, observed.digest.replace(/^sha256:/i, ''))) {
                const error = new Error('SHA-256 của installer đã thay đổi sau khi tải.');
                error.code = 'UPDATE_DOWNLOADED_DIGEST_MISMATCH';
                throw error;
            }
            if (release.asset.digest && !this.#digestMatches(release.asset.digest, observed.digest.replace(/^sha256:/i, ''))) {
                const error = new Error('SHA-256 của installer không còn khớp metadata bản phát hành.');
                error.code = 'UPDATE_DIGEST_MISMATCH';
                throw error;
            }
            return Object.freeze({ verified: true, path: filePath, releaseVersion: release.version, size: observed.size, digest: observed.digest });
        } catch (error) {
            if (error?.code !== 'UPDATE_DOWNLOADED_ARTIFACT_NOT_READY') {
                await this.#cleanupPath(filePath, { force: true }, 'install-integrity-failure');
                this.#setState({
                    phase: 'ERROR',
                    downloadedPath: null,
                    downloadedIntegrity: null,
                    progress: null,
                    lastError: { code: error?.code || null, message: error?.message || String(error) }
                });
            }
            throw error;
        }
    }

    async clearDownloaded() {
        if (this.downloadInFlight || this.state.phase === 'DOWNLOADING') throw new Error('Bản cập nhật đang được tải.');
        if (this.state.downloadedPath) await this.#cleanupPath(path.dirname(this.state.downloadedPath), { recursive: true, force: true }, 'clear-downloaded');
        this.#setState({ downloadedPath: null, downloadedIntegrity: null, progress: null, phase: this.state.available ? 'AVAILABLE' : 'IDLE' });
        return this.status();
    }

    #selectRelease(releases) {
        const candidates = [];
        for (const raw of releases) {
            if (!raw || raw.draft) continue;
            if (this.channel === 'stable' && raw.prerelease) continue;
            const version = normalizeVersion(raw.tag_name || raw.name);
            if (!version) continue;
            const assets = Array.isArray(raw.assets) ? raw.assets : [];
            const assetRaw = assets.find(asset => /mcbot\s*setup\.exe$/i.test(String(asset?.name || '')))
                || assets.find(asset => /setup.*\.exe$/i.test(String(asset?.name || '')));
            if (!assetRaw?.browser_download_url) continue;
            candidates.push({
                version,
                tag: String(raw.tag_name || version),
                name: String(raw.name || raw.tag_name || version),
                notes: String(raw.body || '').slice(0, MAX_RELEASE_BODY),
                publishedAt: raw.published_at || raw.created_at || null,
                prerelease: Boolean(raw.prerelease),
                htmlUrl: /^https:\/\//i.test(String(raw.html_url || '')) ? raw.html_url : null,
                asset: {
                    name: String(assetRaw.name || 'MCbot Setup.exe'),
                    url: String(assetRaw.browser_download_url),
                    size: Number(assetRaw.size || 0) || null,
                    digest: typeof assetRaw.digest === 'string' ? assetRaw.digest : null
                }
            });
        }
        candidates.sort((left, right) => compareVersions(right.version, left.version));
        return candidates[0] || null;
    }

    async #requestJson(url, redirects = 0) {
        const response = await this.#request(url, { headers: this.#headers('application/vnd.github+json') });
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
            if (redirects >= 5) throw new Error('Quá nhiều chuyển hướng khi kiểm tra cập nhật.');
            const location = response.headers.location;
            response.resume();
            return this.#requestJson(this.#redirectUrl(url, location), redirects + 1);
        }
        const chunks = [];
        let total = 0;
        for await (const chunk of response) {
            total += chunk.length;
            if (total > 8 * 1024 * 1024) throw new Error('Phản hồi kiểm tra cập nhật quá lớn.');
            chunks.push(chunk);
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
            const error = new Error(`GitHub API trả về HTTP ${response.statusCode}.`);
            error.code = response.statusCode === 403 ? 'UPDATE_RATE_LIMITED' : 'UPDATE_HTTP_ERROR';
            throw error;
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }

    async #downloadFile(url, destination, asset, redirects = 0) {
        const response = await this.#request(url, { headers: this.#headers('application/octet-stream') });
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
            if (redirects >= 7) throw new Error('Quá nhiều chuyển hướng khi tải cập nhật.');
            const location = response.headers.location;
            response.resume();
            return this.#downloadFile(this.#redirectUrl(url, location), destination, asset, redirects + 1);
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
            response.resume();
            throw new Error(`Tải bản cập nhật thất bại: HTTP ${response.statusCode}.`);
        }
        const headerLength = Number(response.headers['content-length'] || 0) || null;
        const expected = asset.size || headerLength;
        if (expected && expected > MAX_DOWNLOAD_BYTES) throw new Error('File cập nhật vượt giới hạn an toàn 600 MB.');
        const hash = crypto.createHash('sha256');
        const file = fs.createWriteStream(destination, { flags: 'wx' });
        let received = 0;
        let lastEmit = 0;
        try {
            for await (const chunk of response) {
                received += chunk.length;
                if (received > MAX_DOWNLOAD_BYTES) throw new Error('File cập nhật vượt giới hạn an toàn 600 MB.');
                hash.update(chunk);
                if (!file.write(chunk)) await new Promise(resolve => file.once('drain', resolve));
                const now = Date.now();
                if (now - lastEmit >= 150 || (expected && received >= expected)) {
                    lastEmit = now;
                    const percent = expected ? Math.min(100, Math.round((received / expected) * 1000) / 10) : null;
                    this.#setState({ progress: { received, total: expected, percent } });
                }
            }
            await new Promise((resolve, reject) => Reflect.get(file, 'end').call(file, error => error ? reject(error) : resolve()));
        } catch (error) {
            file.destroy();
            throw error;
        }
        if (asset.size && received !== asset.size) throw new Error(`Kích thước file cập nhật không khớp (${received}/${asset.size}).`);
        return hash.digest('hex');
    }

    async #computeFileIntegrity(filePath) {
        const stat = await fsp.stat(filePath);
        if (!stat.isFile()) {
            const error = new Error('Artifact cập nhật không phải file thường.');
            error.code = 'UPDATE_DOWNLOADED_ARTIFACT_INVALID';
            throw error;
        }
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        for await (const chunk of stream) hash.update(chunk);
        return { size: stat.size, digest: `sha256:${hash.digest('hex')}` };
    }

    async #verifyExisting(filePath, asset) {
        try {
            const integrity = await this.#computeFileIntegrity(filePath);
            if (asset.size && integrity.size !== asset.size) return false;
            if (!asset.digest) return true;
            return this.#digestMatches(asset.digest, integrity.digest.replace(/^sha256:/i, ''));
        } catch (error) {
            if (error?.code === 'ENOENT') return false;
            throw error;
        }
    }

    #request(url, options = {}) {
        const target = new URL(url);
        if (target.protocol !== 'https:') throw new Error('Updater chỉ cho phép HTTPS.');
        return new Promise((resolve, reject) => {
            const request = this.https.request(target, { method: 'GET', headers: options.headers || {} }, resolve);
            request.setTimeout(this.timeoutMs, () => request.destroy(new Error('Hết thời gian kết nối máy chủ cập nhật.')));
            request.once('error', reject);
            Reflect.get(request, 'end').call(request);
        });
    }

    #headers(accept) {
        return {
            Accept: accept,
            'User-Agent': this.userAgent,
            'X-GitHub-Api-Version': '2026-03-10'
        };
    }

    #redirectUrl(base, location) {
        if (!location) throw new Error('Máy chủ cập nhật chuyển hướng nhưng thiếu Location.');
        const value = new URL(location, base);
        if (value.protocol !== 'https:') throw new Error('Updater từ chối chuyển hướng không dùng HTTPS.');
        return value.href;
    }

    #digestMatches(expected, actualHex) {
        const match = /^sha256:([a-f0-9]{64})$/i.exec(String(expected || '').trim());
        return match ? match[1].toLowerCase() === String(actualHex || '').toLowerCase() : true;
    }

    async #cleanupPath(target, options, reason) {
        try {
            await this.removePath(target, options);
            this.#setState({ cleanupWarning: null });
            return true;
        } catch (error) {
            this.#setState({
                cleanupWarning: { reason, code: error?.code || null, message: error?.message || String(error) }
            });
            return false;
        }
    }

    #fail(error) {
        this.#setState({ phase: 'ERROR', lastError: { code: error?.code || null, message: error?.message || String(error) } });
    }

    #setState(patch) {
        Object.assign(this.state, patch);
        this.emit('status', this.status());
    }
}

module.exports = GitHubUpdateService;
