'use strict';

class CraftCraftFlow {
    constructor({ crafting }) {
        if (!crafting) throw new TypeError('CraftCraftFlow crafting is required.');
        this.crafting = crafting;
    }

    craft(recipeId, quantity, options = {}) {
        return this.crafting.craft(recipeId, quantity, options);
    }
}

module.exports = CraftCraftFlow;
