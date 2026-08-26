'use strict';

class B5PlanningFlow {
    constructor({ recipeRegistry, config = {} }) {
        if (!recipeRegistry) throw new TypeError('B5PlanningFlow recipeRegistry is required.');
        this.recipeRegistry = recipeRegistry;
        this.config = config;
    }

    planChain(chain = {}) {
        const plannedB2Exact = Math.max(0, Number(chain.b2Crafts || 0));
        const plannedB3 = Math.max(0, Number(chain.b3Crafts || 0));
        const b2BatchSize = Math.max(1, Number(this.config?.quantityOptimization?.b2BatchSize || 64));
        const b2InputSource = this.config?.b2InputSource === 'inventory' ? 'inventory' : 'storage';
        const useAllForB2 = b2InputSource === 'storage'
            && this.config?.quantityOptimization?.enabled !== false
            && this.config?.quantityOptimization?.useAllForB2 === true;
        const b2Recipe = this.recipeRegistry.require(chain.b2RecipeId);
        const basePerB2 = Math.max(0, Number(b2Recipe?.inputs?.[chain.baseId] || 0));
        const immediatelyCraftable = Math.max(0, Number(chain.storedEffective || 0));
        const totalEffective = Math.max(immediatelyCraftable, Number(chain.storedTotalEffective || 0));
        const totalKnown = Number.isFinite(totalEffective) && basePerB2 > 0;
        const immediateB2Crafts = totalKnown ? Math.floor(immediatelyCraftable / basePerB2) : null;
        const totalB2Crafts = totalKnown ? Math.floor(totalEffective / basePerB2) : null;

        let plannedB2 = 0;
        if (plannedB2Exact > 0) {
            if (useAllForB2) {
                // Total stock answers "do we own enough B1 to start?". Whether
                // compressed stock can be expanded safely is a storage-flow
                // concern and must not be collapsed into "material missing".
                plannedB2 = totalKnown && totalB2Crafts < 1 ? 0 : plannedB2Exact;
            } else {
                const roundedNeed = Math.ceil(plannedB2Exact / b2BatchSize) * b2BatchSize;
                const availableFullBatches = totalKnown
                    ? Math.floor(totalB2Crafts / b2BatchSize) * b2BatchSize
                    : roundedNeed;
                plannedB2 = Math.max(0, Math.min(roundedNeed, availableFullBatches));
            }
        }

        const requiredRawForStart = plannedB2 > 0 && basePerB2 > 0
            ? (useAllForB2 ? basePerB2 : plannedB2 * basePerB2)
            : Math.max(0, Number(chain.rawNeededFromStorage || 0));

        return Object.freeze({
            plannedB2Exact,
            plannedB2,
            plannedB3,
            b2BatchSize,
            useAllForB2,
            b2InputSource,
            basePerB2,
            requiredRawForStart,
            immediatelyCraftable,
            totalEffective,
            immediateB2Crafts,
            totalB2Crafts,
            decompressionBlocked: totalEffective > immediatelyCraftable,
            nextAction: plannedB2 > 0
                ? (totalEffective > immediatelyCraftable ? 'PREPARE_B1' : 'CRAFT_B2')
                : (plannedB3 > 0 ? 'CRAFT_B3' : 'WAIT_MATERIAL')
        });
    }
}

module.exports = B5PlanningFlow;
