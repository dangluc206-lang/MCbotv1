'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const CONTRACT = 'desktop-readiness-v1';

function check(id, status, summary, remediation = null, details = null) {
    return Object.freeze({ id, status, ready: status === 'READY', summary, remediation, details });
}

class DesktopReadinessService {
    constructor({ baseDir, controllerProvider, secretStoreProvider, versionProvider, runtimeProvenanceProvider = null, fsImpl = fs } = {}) {
        if (!baseDir) throw new TypeError('DesktopReadinessService baseDir is required.');
        this.baseDir = path.resolve(baseDir);
        this.controllerProvider = controllerProvider || (() => null);
        this.secretStoreProvider = secretStoreProvider || (() => null);
        this.versionProvider = versionProvider || (() => null);
        this.runtimeProvenanceProvider = runtimeProvenanceProvider;
        this.fs = fsImpl;
    }

    async sample() {
        const controller = this.controllerProvider();
        const version = String(this.versionProvider() || '').trim();
        const checks = [];
        checks.push(check('runtime-version', version ? 'READY' : 'BLOCKED', version ? `MCbot ${version}` : 'Không đọc được phiên bản runtime.', version ? null : 'Cài đặt lại bản phát hành hợp lệ.'));
        checks.push(await this.#writableConfig());
        if (this.runtimeProvenanceProvider) checks.push(await this.#runtimeProvenance());
        const lifecycle = controller?.lifecycle || 'STOPPED';
        const bootFailure = controller?.bootFailure || null;
        checks.push(check('configuration', lifecycle === 'RUNNING' ? 'READY' : bootFailure?.category === 'CONFIG' ? 'BLOCKED' : 'UNKNOWN', lifecycle === 'RUNNING' ? 'Cấu hình đã được backend xác thực.' : bootFailure?.operatorSummary || 'Cấu hình sẽ được xác thực đầy đủ khi khởi động backend.', bootFailure?.category === 'CONFIG' ? 'Mở workspace cấu hình và sửa trường được báo.' : null));
        let secretStatus = null;
        try { secretStatus = this.secretStoreProvider()?.status?.() || null; }
        catch (error) { secretStatus = { state: 'UNAVAILABLE', remediation: error.message }; }
        checks.push(check('secret-provider', secretStatus?.state === 'READY' ? 'READY' : secretStatus?.state === 'UNAVAILABLE' ? 'BLOCKED' : 'NEEDS_SETUP', secretStatus?.state === 'READY' ? 'Kho bí mật hệ điều hành sẵn sàng.' : 'Kho bí mật cần được cấu hình.', secretStatus?.remediation || 'Mở Cài đặt > Bảo mật.', secretStatus ? { state: secretStatus.state, configuredKeys: secretStatus.keys?.length || 0 } : null));
        let profiles = [];
        if (lifecycle === 'RUNNING') {
            try { profiles = await controller.listProfiles(); } catch { profiles = []; }
        }
        checks.push(check('bot-profile', profiles.length ? 'READY' : lifecycle === 'RUNNING' ? 'NEEDS_SETUP' : 'UNKNOWN', profiles.length ? `${profiles.length} hồ sơ bot.` : 'Chưa xác nhận có hồ sơ bot.', profiles.length ? null : 'Tạo hoặc bật một hồ sơ bot.'));
        const enabled = profiles.filter(profile => profile.enabled !== false).length;
        checks.push(check('enabled-bot', enabled > 0 ? 'READY' : profiles.length ? 'NEEDS_SETUP' : 'UNKNOWN', enabled > 0 ? `${enabled} bot đã bật.` : 'Chưa có bot nào được bật.', enabled > 0 ? null : 'Kiểm tra hồ sơ rồi bật bot cần vận hành.'));
        checks.push(check('backend', lifecycle === 'RUNNING' ? 'READY' : lifecycle === 'FAILED' ? 'BLOCKED' : 'NEEDS_SETUP', lifecycle === 'RUNNING' ? 'Backend đang chạy.' : `Backend: ${lifecycle}.`, lifecycle === 'FAILED' ? 'Mở Incident Center hoặc Chẩn đoán trước khi thử lại.' : 'Khởi động backend khi đã sẵn sàng.'));
        const blocking = checks.filter(entry => entry.status === 'BLOCKED').length;
        const incomplete = checks.filter(entry => entry.status !== 'READY').length;
        return Object.freeze({
            contract: CONTRACT,
            overall: blocking ? 'BLOCKED' : incomplete ? 'INCOMPLETE' : 'READY',
            ready: incomplete === 0,
            checks: Object.freeze(checks),
            sampledAt: new Date().toISOString(),
            sideEffects: 'NONE'
        });
    }

    async #writableConfig() {
        const root = path.join(this.baseDir, 'config');
        try {
            await this.fs.access(root, 2);
            return check('config-root-writable', 'READY', 'Thư mục cấu hình có quyền ghi.', null, { root: 'config' });
        } catch (error) {
            return check('config-root-writable', 'BLOCKED', 'Không thể ghi thư mục cấu hình.', 'Kiểm tra quyền thư mục runtime hoặc cài đặt lại.', { code: error?.code || null, root: 'config' });
        }
    }

    async #runtimeProvenance() {
        try {
            const provenance = await this.runtimeProvenanceProvider();
            const blocked = provenance?.status === 'BLOCKED';
            const connectionPaths = provenance?.connectionRelevant?.paths || [];
            const customizedRemediation = provenance?.parity === 'RUNTIME_CUSTOMIZED' && connectionPaths.length
                ? `Desktop dùng AppData runtime; kiểm tra ${connectionPaths.slice(0, 3).join(', ')} nếu hành vi khác core:start.`
                : null;
            return check(
                'runtime-config-source',
                blocked ? 'BLOCKED' : 'READY',
                provenance?.summary || 'Đã xác định nguồn cấu hình runtime.',
                blocked ? 'Chạy lại migration hoặc khôi phục cấu hình runtime trước khi kết nối bot.' : customizedRemediation,
                provenance || null
            );
        } catch (error) {
            return check(
                'runtime-config-source',
                'BLOCKED',
                'Không thể xác minh nguồn cấu hình runtime.',
                'Kiểm tra runtime config và chạy lại Desktop.',
                { code: error?.code || 'DESKTOP_RUNTIME_PROVENANCE_FAILED' }
            );
        }
    }
}

DesktopReadinessService.CONTRACT = CONTRACT;
module.exports = DesktopReadinessService;
