'use strict';

const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');

class CraftingService {
    constructor({ operation }) {
        this.operation = operation;
    }

    async craft(recipeId, amount) {
        try {
            return Result.ok(await this.operation.execute(recipeId, amount));
        } catch (error) {
            return Result.fail(Status.FAILED, error.message, error, { recipeId, amount });
        }
    }

    async executeStep(step) {
        try {
            const results = [];
            const actions = step.quantityActions || [];
            for (const action of actions) {
                for (let repeat = 0; repeat < action.repeats; repeat += 1) {
                    results.push(await this.operation.execute(step.recipeId, action.amount));
                }
            }
            return Result.ok({
                recipeId: step.recipeId,
                outputId: step.outputId,
                crafts: step.crafts,
                actions,
                results
            });
        } catch (error) {
            return Result.fail(Status.FAILED, error.message, error, {
                recipeId: step.recipeId,
                outputId: step.outputId
            });
        }
    }
}

module.exports = CraftingService;
