'use strict';

const Operation = require('../../operations/Operation');
const Result = require('../../shared/result/Result');

class CraftingService {
    constructor({ operation, operationManager = null, context = null }) {
        this.operation = operation;
        this.operationManager = operationManager;
        this.context = context;
    }

    async craft(recipeId, amount, options = {}) {
        if (!this.operationManager) return this.#legacyCraft(recipeId, amount, options);
        const generation = options.expectedGeneration ?? options.operationContext?.connectionGeneration ?? this.context?.getGeneration?.() ?? null;
        const operation = new Operation({
            name: 'CraftingOperation',
            lockKeys: ['gui', 'crafting', 'inventory'],
            execute: context => this.operation.execute(recipeId, amount, {
                ...options,
                operationContext: context,
                cancellationToken: context.cancellation.token,
                expectedGeneration: context.connectionGeneration
            })
        });
        return this.operationManager.run(operation, {
            operationContext: options.operationContext || null,
            cancellationToken: options.cancellationToken || null,
            connectionGeneration: generation,
            timeoutMs: options.timeoutMs,
            queueWaitTimeoutMs: options.queueWaitTimeoutMs,
            correlationId: options.correlationId || null,
            metadata: { subsystem: 'crafting', recipeId, amount }
        });
    }

    async executeStep(step, options = {}) {
        try {
            const results = [];
            const actions = step.quantityActions || [];
            for (const action of actions) {
                for (let repeat = 0; repeat < action.repeats; repeat += 1) {
                    const result = await this.craft(step.recipeId, action.amount, options);
                    if (result?.success === false) return result;
                    results.push(result?.data ?? result);
                }
            }
            return Result.ok({ recipeId: step.recipeId, outputId: step.outputId, crafts: step.crafts, actions, results });
        } catch (error) {
            return Result.fail(this.#status(error), error.message, error, { recipeId: step.recipeId, outputId: step.outputId });
        }
    }

    async #legacyCraft(recipeId, amount, options) {
        try { return Result.ok(await this.operation.execute(recipeId, amount, options)); }
        catch (error) { return Result.fail(this.#status(error), error.message, error, { recipeId, amount }); }
    }

    #status(error) {
        return Operation.statusForError(error);
    }
}

module.exports = CraftingService;