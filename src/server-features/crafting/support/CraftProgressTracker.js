'use strict';

class CraftProgressTracker {
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
        if (kind === 'SPACE' || state === 'FREEING_SPACE') return 'Craft: freeing output space.';
        if (kind === 'PREPARE_BASE' || kind === 'PREPARE_B1' || state === 'PREPARING_BASE' || state === 'PREPARING_B1') return 'Craft: preparing base material.';
        if (kind === 'TARGET' || state === 'CRAFTING_TARGET') return 'Craft: crafting target.';
        if (kind === 'INTERMEDIATE' || kind === 'B2/B3' || state === 'CRAFTING_INTERMEDIATE') return 'Craft: crafting intermediate.';
        // ponytail: legacy B-chain kinds/states below are compat-only so reserve
        // work still emits an activity log on the generic path. Wording stays
        // generic (no 'B5:' prefix, no B5>B4>B3>B2 priority); the B vocabulary
        // itself stays at the B5 policy/presentation boundary and is removed
        // with the B5 coordinators (Slice 6). No priority is stored on state.
        if (kind === 'B2' || state === 'CRAFTING_B2') return 'Craft: crafting reserve input.';
        if (kind === 'B3' || state === 'CRAFTING_B3') return 'Craft: crafting reserve output.';
        if (kind === 'B4' || state === 'CRAFTING_B4') return 'Craft: crafting direct input.';
        if (kind === 'B5' || state === 'CRAFTING_B5') return 'Craft: crafting target.';
        if (kind === 'DEPOSIT' || state === 'DEPOSITING') return 'Craft: depositing output.';
        if (kind === 'VERIFY' || state === 'VERIFYING') return 'Craft: verifying output.';
        if (kind === 'CONVERT_BLOCKS' || state === 'COMPACTING') return 'Craft: compacting blocks.';
        if (kind === 'SELL' || state === 'SELLING') return 'Craft: selling surplus.';
        if (kind === 'STORE' || state === 'STORING') return 'Craft: storing materials.';
        if (kind === 'PLAN') return 'Craft: computing remaining steps.';
        return null;
    }
}

module.exports = CraftProgressTracker;
