'use strict';

class CollectorB5StatusPresenter {
    b5Progress(data, phase) {
        const progress = data?.progress || null;
        if (!progress) return null;
        return Object.freeze({
            ...progress,
            phase,
            updatedAt: new Date().toISOString()
        });
    }

    b3Shortages(data) {
        const chains = Array.isArray(data?.chains) ? data.chains : [];
        const progressB3 = new Map((data?.progress?.b3 || []).map(entry => [entry.id, entry]));
        return Object.freeze(chains.map(chain => {
            const progress = progressB3.get(chain.b3Id) || {};
            return Object.freeze({
                b3Id: chain.b3Id,
                b2Id: chain.b2Id,
                missing: Math.max(0, Number(chain.b3Crafts || 0)),
                vault: Math.max(0, Number(chain.vaultB3 || 0)),
                inventory: Math.max(0, Number(chain.inventoryB3 || 0)),
                ownedB2: Math.max(0, Number(progress.ownedB2 || 0)),
                promotableFromOwnedB2: Math.max(0, Number(progress.promotableFromOwnedB2 || 0))
            });
        }));
    }

    activity({ enabled, paused, phase, automationProgress, b5Progress }) {
        if (!enabled) return 'Đã tắt';
        if (paused) return 'Tạm dừng';
        const step = automationProgress?.currentStep || null;
        const kind = String(step?.kind || '').toUpperCase();
        const state = String(automationProgress?.state || '').toUpperCase();
        if (phase === 'CRAFTING' || automationProgress?.running) {
            if (kind === 'PREPARE_B1' || state === 'PREPARING_B1') return 'Đang chuẩn bị B1';
            if (kind === 'B2' || state === 'CRAFTING_B2') return 'Đang chế B2';
            if (kind === 'B3' || state === 'CRAFTING_B3') return 'Đang chế B3';
            if (kind === 'B2/B3' || state === 'CRAFTING_INTERMEDIATE') return 'Đang chuẩn bị B2/B3';
            if (kind === 'B4' || state === 'CRAFTING_B4') return 'Đang chế B4';
            if (kind === 'B5' || state === 'CRAFTING_B5') return 'Đang chế B5';
            if (kind === 'DEPOSIT' || state === 'DEPOSITING') return 'Đang cất B5';
            if (kind === 'VERIFY' || state === 'VERIFYING') return 'Đang xác nhận B5';
            if (kind === 'CONVERT_BLOCKS') return 'Đang đổi khối';
            if (kind === 'SELL') return 'Đang bán';
            if (kind === 'STORE') return 'Đang cất nguyên liệu';
            if (kind === 'PLAN') return 'Đang tính các bước còn lại';
            return 'Đang chế tạo';
        }
        const byPhase = {
            STARTING: 'Đang bắt đầu',
            STARTUP_STORAGE_SAFETY: 'Đang cân B1 theo reserve cấu hình',
            RESUMING: 'Đang chạy tiếp',
            WAITING_CONNECTION: 'Đang chờ kết nối',
            WAITING_SKYBLOCK: 'Đang vào SkyBlock',
            HOMING: 'Đang về đảo',
            MOVING_TO_PICKUP: 'Đang đến điểm nhặt',
            REANCHORING: 'Đang quay lại điểm nhặt',
            PREPROCESSING: 'Đang nung / đổi khối',
            CHECKING: 'Đang tính các bước còn lại',
            COLLECTING: 'Đang nhặt / chờ nguyên liệu',
            MAINTENANCE: 'Đang bảo trì kho',
            WAITING_RETRY: 'Đang thử lại',
            DEGRADED: 'Đang backoff sau lỗi',
            PAUSED_ERROR: 'Tạm dừng do lỗi',
            DAILY_SERVER_RECOVERY_WAIT: 'Đang chờ server',
            DAILY_SKY_RECOVERY_WAIT: 'Đang chờ vào lại SkyBlock'
        };
        return byPhase[phase] || (Number(b5Progress?.remainingStages) === 0 ? 'Đã thành công' : 'Đang chạy');
    }
}

module.exports = CollectorB5StatusPresenter;
