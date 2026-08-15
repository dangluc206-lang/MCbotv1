'use strict';

class CraftingPlan {
    constructor({ targetId, amount, steps, baseMaterials, missing = {}, availableUsed = {}, remainingAvailable = {} }) {
        this.targetId = targetId;
        this.amount = amount;
        this.steps = Object.freeze([...steps]);
        this.baseMaterials = Object.freeze({ ...baseMaterials });
        this.missing = Object.freeze({ ...missing });
        this.availableUsed = Object.freeze({ ...availableUsed });
        this.remainingAvailable = Object.freeze({ ...remainingAvailable });
        Object.freeze(this);
    }

    get feasible() {
        return Object.keys(this.missing).length === 0;
    }
}

module.exports = CraftingPlan;
