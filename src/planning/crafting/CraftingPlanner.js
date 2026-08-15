'use strict';

const CraftingPlan = require('./CraftingPlan');
const CraftingStep = require('./CraftingStep');

class CraftingPlanner {
    constructor({ recipeRegistry, materialCalculator }) {
        this.recipeRegistry = recipeRegistry;
        this.materialCalculator = materialCalculator;
    }

    plan(targetId, amount, available = {}) {
        if (!Number.isInteger(amount) || amount < 1) {
            throw new RangeError('amount must be a positive integer');
        }

        const byOutput = this.#buildOutputIndex();
        const stock = this.#normalizeAvailable(available);
        const availableUsed = {};
        const missing = {};
        const craftCounts = new Map();
        const order = [];
        const visiting = new Set();

        const consume = (logicalId, requiredAmount) => {
            if (requiredAmount <= 0) return;

            const inStock = Number(stock[logicalId] || 0);
            const used = Math.min(inStock, requiredAmount);
            if (used > 0) {
                stock[logicalId] = inStock - used;
                availableUsed[logicalId] = (availableUsed[logicalId] || 0) + used;
            }

            const remaining = requiredAmount - used;
            if (remaining <= 0) return;

            const entry = byOutput.get(logicalId);
            if (!entry) {
                missing[logicalId] = (missing[logicalId] || 0) + remaining;
                return;
            }
            if (visiting.has(entry.recipeId)) {
                throw new Error(`Recipe cycle detected: ${entry.recipeId}`);
            }

            visiting.add(entry.recipeId);
            const outputAmount = Number(entry.recipe.outputAmount || 1);
            const crafts = Math.ceil(remaining / outputAmount);
            for (const [inputId, inputAmount] of Object.entries(entry.recipe.inputs || {})) {
                consume(inputId, Number(inputAmount) * crafts);
            }
            visiting.delete(entry.recipeId);

            if (!craftCounts.has(entry.recipeId)) order.push(entry.recipeId);
            craftCounts.set(entry.recipeId, (craftCounts.get(entry.recipeId) || 0) + crafts);

            const produced = outputAmount * crafts;
            const excess = produced - remaining;
            if (excess > 0) stock[logicalId] = (stock[logicalId] || 0) + excess;
        };

        consume(targetId, amount);

        const steps = order.map(recipeId => {
            const recipe = this.recipeRegistry.require(recipeId);
            const crafts = craftCounts.get(recipeId);
            return new CraftingStep({
                recipeId,
                outputId: recipe.output,
                crafts,
                quantityBatches: this.#quantityBatches(crafts),
                inputs: Object.fromEntries(
                    Object.entries(recipe.inputs || {}).map(([id, count]) => [id, Number(count) * crafts])
                )
            });
        });

        return new CraftingPlan({
            targetId,
            amount,
            steps,
            baseMaterials: this.materialCalculator.requirements(targetId, amount),
            missing,
            availableUsed,
            remainingAvailable: stock
        });
    }

    #buildOutputIndex() {
        const byOutput = new Map();
        for (const recipeId of this.recipeRegistry.ids()) {
            const recipe = this.recipeRegistry.require(recipeId);
            if (byOutput.has(recipe.output)) throw new Error(`Multiple recipes produce ${recipe.output}.`);
            byOutput.set(recipe.output, { recipeId, recipe });
        }
        return byOutput;
    }

    #normalizeAvailable(available) {
        const stock = {};
        for (const [id, count] of Object.entries(available || {})) {
            const value = Number(count);
            if (!Number.isSafeInteger(value) || value < 0) {
                throw new TypeError(`available.${id} must be a non-negative safe integer`);
            }
            stock[id] = value;
        }
        return stock;
    }

    #quantityBatches(crafts) {
        const result = [];
        let remaining = crafts;
        while (remaining >= 64) {
            result.push(64);
            remaining -= 64;
        }
        while (remaining > 0) {
            result.push(1);
            remaining -= 1;
        }
        return result;
    }
}

module.exports = CraftingPlanner;
