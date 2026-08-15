'use strict';

class CraftingStep {
    constructor({ recipeId, outputId, crafts, quantityBatches, inputs }) {
        const batches = Object.freeze([...(quantityBatches || [])]);
        Object.assign(this, {
            recipeId,
            outputId,
            crafts,
            quantityBatches: batches,
            quantityActions: Object.freeze(this.#compress(batches)),
            inputs: Object.freeze({ ...(inputs || {}) })
        });
        Object.freeze(this);
    }

    #compress(batches) {
        const actions = [];
        for (const amount of batches) {
            const previous = actions.at(-1);
            if (previous?.amount === amount) previous.repeats += 1;
            else actions.push({ amount, repeats: 1 });
        }
        return actions.map(action => Object.freeze({ ...action }));
    }
}

module.exports = CraftingStep;
