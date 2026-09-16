'use strict';

const UNBOUNDED = 'CRAFTING_CHAIN_QUANTITY_UNBOUNDED';

/**
 * Pure chain planner facade: takes a validated CraftingRequest (target item +
 * quantity) and describes the full crafting chain — steps, craft counts,
 * intermediates and final materials — by delegating the math to the existing
 * CraftingPlanner and enriching steps with data from the CraftingItemRegistry.
 * No execution side effects. Quantity mode ALL is rejected here: it belongs to
 * the request layer and never turns into an unbounded loop.
 */
class CraftingChainPlanner {
    constructor({ craftingPlanner, craftingItemRegistry }) {
        if (!craftingPlanner || typeof craftingPlanner.plan !== 'function') throw new TypeError('CraftingPlanner is required.');
        if (!craftingItemRegistry || typeof craftingItemRegistry.resolveById !== 'function') throw new TypeError('CraftingItemRegistry is required.');
        this.craftingPlanner = craftingPlanner;
        this.craftingItemRegistry = craftingItemRegistry;
    }

    plan({ request, available = {} } = {}) {
        if (!request || request.quantityMode === undefined) throw new TypeError('CraftingRequest instance is required.');
        if (request.quantityMode === 'ALL') {
            throw Object.assign(new TypeError(`Unbounded quantity "ALL" must be resolved to a finite amount before planning (target: ${request.targetItemId}).`), { code: UNBOUNDED, targetItemId: request.targetItemId });
        }
        const plan = this.craftingPlanner.plan(request.targetItemId, request.quantity, available);
        const steps = plan.steps.map(step => {
            const entry = this.craftingItemRegistry.resolveById(step.outputId);
            return Object.freeze({
                recipeId: step.recipeId,
                outputId: step.outputId,
                displayName: entry?.displayName || step.outputId,
                tier: entry?.tier || null,
                crafts: step.crafts,
                inputs: step.inputs,
                quantityBatches: step.quantityBatches,
                quantityActions: step.quantityActions
            });
        });
        return Object.freeze({
            targetItemId: plan.targetId,
            targetDisplayName: request.targetDisplayName,
            requiredQuantity: plan.amount,
            steps: Object.freeze(steps),
            intermediates: Object.freeze(steps.filter(step => step.outputId !== plan.targetId).map(step => step.outputId)),
            finalMaterials: plan.baseMaterials,
            missing: plan.missing,
            availableUsed: plan.availableUsed,
            remainingAvailable: plan.remainingAvailable,
            feasible: plan.feasible
        });
    }
}

CraftingChainPlanner.UNBOUNDED = UNBOUNDED;
module.exports = CraftingChainPlanner;
