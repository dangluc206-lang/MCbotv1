'use strict';

class CraftingStep {
    constructor({ recipeId, outputId, crafts, inputs }) {
        Object.assign(this, {
            recipeId,
            outputId,
            crafts,
            inputs: Object.freeze({ ...(inputs || {}) })
        });
        Object.freeze(this);
    }
}

module.exports = CraftingStep;
