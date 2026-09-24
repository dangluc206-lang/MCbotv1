'use strict';

/**
 * Tier-derived stage classification for the generic craft inspection path.
 * Reads tiers from configuration data; `partition` splits a CraftingPlan into
 * reserve steps vs final steps, and `stageKind` names a step kind from tier
 * metadata — never from hard-coded tier names. Generic paths carry these
 * generic kinds ('TARGET', 'RESERVE', 'PREPARE_BASE', 'INTERMEDIATE');
 * consumers translate them to their own legacy names for compatibility.
 */
class CraftStageClassifier {
    constructor({ tiers = {}, reserveTiers = [], targetKind = 'TARGET' } = {}) {
        this.tiers = tiers || {};
        this.reserveTiers = Object.freeze([...(reserveTiers || [])]);
        this.targetKind = targetKind;
        this.tierByItem = new Map();
        for (const [tier, ids] of Object.entries(this.tiers || {})) {
            for (const id of ids || []) this.tierByItem.set(id, tier);
        }
    }

    partition(plan) {
        const reserveSteps = [];
        const finalSteps = [];
        for (const step of plan?.steps || []) {
            if (this.reserveTiers.includes(this.tierByItem.get(step.outputId) || null)) reserveSteps.push(step);
            else finalSteps.push(step);
        }
        return Object.freeze({ reserveSteps: Object.freeze(reserveSteps), finalSteps: Object.freeze(finalSteps) });
    }

    kindOf(outputId) {
        const tier = this.tierByItem.get(String(outputId || '').trim()) || null;
        return tier || 'INTERMEDIATE';
    }

    stageKind(outputId, targetId) {
        if (String(outputId || '').trim() === String(targetId || '').trim()) return this.targetKind;
        return this.kindOf(outputId);
    }
}

module.exports = CraftStageClassifier;
