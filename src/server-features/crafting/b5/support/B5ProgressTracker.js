'use strict';

class B5ProgressTracker {
    constructor({ logger = null } = {}) {
        this.logger = logger;
        this.lastActivityLogKey = null;
        this.value = Object.freeze({
            running: false,
            state: 'IDLE',
            currentStep: null,
            remainingStages: null,
            remainingCrafts: null,
            updatedAt: null
        });
    }

    status() {
        return this.value;
    }

    set(patch = {}) {
        this.value = Object.freeze({
            ...this.value,
            ...patch,
            updatedAt: new Date().toISOString()
        });
        const activity = this.#activityLabel(this.value);
        if (activity && activity !== this.lastActivityLogKey) {
            this.lastActivityLogKey = activity;
            this.logger?.info?.(activity);
        }
        return this.value;
    }

    sync(data, targetId, override = {}) {
        const progress = data?.progress || {};
        return this.set({
            running: true,
            state: progress.state || (progress.feasible ? 'READY' : 'PREPARING'),
            currentStep: progress.nextStep || { kind: 'PLAN', id: targetId },
            remainingStages: Number(progress.remainingStages || 0),
            remainingCrafts: Number(progress.remainingCrafts || 0),
            targetId,
            priority: 'B5>B4>B3>B2',
            ...override
        });
    }

    advance(stages = 1, crafts = 0) {
        const currentStages = Number(this.value?.remainingStages);
        const currentCrafts = Number(this.value?.remainingCrafts);
        return this.set({
            remainingStages: Number.isFinite(currentStages)
                ? Math.max(0, currentStages - Math.max(0, Number(stages || 0)))
                : currentStages,
            remainingCrafts: Number.isFinite(currentCrafts)
                ? Math.max(0, currentCrafts - Math.max(0, Number(crafts || 0)))
                : currentCrafts
        });
    }

    #activityLabel(progress) {
        const kind = String(progress?.currentStep?.kind || '').toUpperCase();
        const state = String(progress?.state || '').toUpperCase();
        if (kind === 'SPACE' || state === 'FREEING_SPACE') return 'B5: Đang giải phóng chỗ trống.';
        if (kind === 'PREPARE_B1' || state === 'PREPARING_B1') return 'B5: Đang chuẩn bị B1.';
        if (kind === 'B2' || state === 'CRAFTING_B2') return 'B5: Đang chế B2.';
        if (kind === 'B3' || state === 'CRAFTING_B3') return 'B5: Đang chế B3.';
        if (kind === 'B2/B3' || state === 'CRAFTING_INTERMEDIATE') return 'B5: Đang chuẩn bị B2/B3.';
        if (kind === 'B4' || state === 'CRAFTING_B4') return 'B5: Đang chế B4.';
        if (kind === 'B5' || state === 'CRAFTING_B5') return 'B5: Đang chế B5.';
        if (kind === 'DEPOSIT' || state === 'DEPOSITING') return 'B5: Đang cất B5.';
        if (kind === 'VERIFY' || state === 'VERIFYING') return 'B5: Đang xác nhận B5.';
        if (kind === 'CONVERT_BLOCKS' || state === 'COMPACTING') return 'B5: Đang đổi khối.';
        if (kind === 'SELL' || state === 'SELLING') return 'B5: Đang bán.';
        if (kind === 'STORE' || state === 'STORING') return 'B5: Đang cất nguyên liệu.';
        if (kind === 'PLAN') return 'B5: Đang tính các bước còn lại.';
        return null;
    }
}

module.exports = B5ProgressTracker;
