'use strict';

const EventEmitter = require('node:events');
const { normalizeVersion } = require('./Version');

class GitHubUpdateService extends EventEmitter {
    constructor({ currentVersion } = {}) {
        super();
        const normalizedVersion = normalizeVersion(currentVersion);
        if (!normalizedVersion) throw new TypeError('UpdateService currentVersion không hợp lệ.');
        this.currentVersion = normalizedVersion;
        this.state = Object.freeze({
            phase: 'DISABLED',
            checkedAt: null,
            available: false,
            release: null,
            downloaded: false,
            downloadedPath: null,
            downloadedIntegrity: null,
            progress: null,
            lastError: null,
            cleanupWarning: null,
            reason: 'Remote repository updates are disabled. Use local ZIP update instead.'
        });
    }

    configure() {
        return this.status();
    }

    status() {
        return {
            currentVersion: this.currentVersion,
            repository: null,
            channel: null,
            ...this.state
        };
    }

    async check() {
        return this.status();
    }

    async download() {
        const error = new Error('Cập nhật từ kho từ xa đã bị loại bỏ. Hãy dùng gói ZIP cục bộ.');
        error.code = 'REMOTE_UPDATE_DISABLED';
        throw error;
    }

    async verifyDownloadedArtifact() {
        const error = new Error('Không có artifact cập nhật từ xa.');
        error.code = 'REMOTE_UPDATE_DISABLED';
        throw error;
    }

    async clearDownloaded() {
        return this.status();
    }
}

module.exports = GitHubUpdateService;
