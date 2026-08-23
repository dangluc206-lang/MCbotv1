'use strict';

class B5RecipeResolver {
    constructor({ recipeRegistry, config = {}, logger = null } = {}) {
        if (!recipeRegistry?.require) throw new TypeError('B5RecipeResolver recipeRegistry is required.');
        this.recipeRegistry = recipeRegistry;
        this.config = config || {};
        this.logger = logger;
    }

    recipeForOutput(outputId, fallbackSteps = []) {
        const directStep = (fallbackSteps || []).find(step => step?.outputId === outputId && step?.recipeId);
        if (directStep) {
            try {
                return { recipeId: directStep.recipeId, recipe: this.recipeRegistry.require(directStep.recipeId) };
            } catch (error) {
                this.#logLookupFallback(error, directStep.recipeId, outputId);
            }
        }
        if (typeof this.recipeRegistry?.ids === 'function') {
            for (const recipeId of this.recipeRegistry.ids()) {
                try {
                    const recipe = this.recipeRegistry.require(recipeId);
                    if (recipe?.output === outputId) return { recipeId, recipe };
                } catch (error) {
                    this.#logLookupFallback(error, recipeId, outputId);
                }
            }
        }
        try {
            const recipe = this.recipeRegistry.require(outputId);
            if (recipe && (!recipe.output || recipe.output === outputId)) return { recipeId: outputId, recipe };
        } catch (error) {
            this.#logLookupFallback(error, outputId, outputId);
        }
        return null;
    }

    isB5DirectlyReady(data, amount = 1) {
        const targetId = data?.fullPlan?.targetId || this.config?.targetId || 'super_alloy';
        const targetRecipe = this.recipeForOutput(targetId, data?.finalSteps || []);
        if (!targetRecipe?.recipe) return false;
        const available = data?.nonStorageAvailable || {};
        const targetAmount = Math.max(1, Number(amount || 1));
        const entries = Object.entries(targetRecipe.recipe.inputs || {}).filter(([, count]) => Number(count) > 0);
        if (entries.length === 0) return false;
        return entries.every(([id, perCraft]) =>
            Number(available[id] || 0) >= Number(perCraft) * targetAmount
        );
    }

    #logLookupFallback(error, recipeId, outputId) {
        this.logger?.debug?.('B5 recipe lookup skipped an unavailable recipe candidate.', {
            operation: 'B5RecipeResolver',
            step: 'resolve-recipe',
            recipeId,
            outputId,
            error: {
                name: error?.name || 'Error',
                code: error?.code || null,
                message: error?.message || String(error)
            }
        });
    }
}

module.exports = B5RecipeResolver;
