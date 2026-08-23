'use strict';

class B5CraftFlow {
    constructor({ crafting }) {
        if (!crafting) throw new TypeError('B5CraftFlow crafting is required.');
        this.crafting = crafting;
    }

    craft(recipeId, quantity, options = {}) {
        return this.crafting.craft(recipeId, quantity, options);
    }
}

module.exports = B5CraftFlow;
