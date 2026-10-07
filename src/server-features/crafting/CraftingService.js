'use strict';

const Operation = require('../../operations/Operation');
const Result = require('../../shared/result/Result');
const QuantityStrategy = require('./quantity/QuantityStrategy');

class CraftingService {
    constructor({ operation, operationManager = null, context = null, quantityStrategy = null } = {}) {
        this.operation = operation;
        this.operationManager = operationManager;
        this.context = context;
        this.quantityStrategy = quantityStrategy || new QuantityStrategy();
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
            const outputAmount = Number(step.outputAmount || options.outputAmount || 1);
            // Exact-quantity: batching belongs to the strategy, never to the planner.
            const batches = QuantityStrategy.planBatches(Number(step.crafts || 0), {
                maxBatch: Number(options.maxBatch || 64)
            });
            for (const amount of batches) {
                const result = await this.craft(step.recipeId, amount, { ...options, outputAmount });
                if (result?.success === false) return result;
                results.push(result?.data ?? result);
            }
            return Result.ok({ recipeId: step.recipeId, outputId: step.outputId, crafts: step.crafts, batches, results });
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