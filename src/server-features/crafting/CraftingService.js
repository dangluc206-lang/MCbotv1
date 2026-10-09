'use strict';

const Operation = require('../../operations/Operation');
const Result = require('../../shared/result/Result');
const QuantityStrategy = require('./quantity/QuantityStrategy');

class CraftingService {
    constructor({ operation, operationManager = null, context = null, quantityStrategy = null, recipeRegistry = null, procedureRegistry = null } = {}) {
        this.operation = operation;
        this.operationManager = operationManager;
        this.context = context;
        this.quantityStrategy = quantityStrategy || new QuantityStrategy();
        this.recipeRegistry = recipeRegistry;
        this.procedureRegistry = procedureRegistry;
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
            // G14.2: batching follows procedure capability, never a hardcoded 64.
            // QuantityStrategy stays the pure batch planner; here we only pick the cap.
            const { maxBatch, strategy } = this.#procedureBatchPolicy(step.recipeId, options);
            const batches = QuantityStrategy.planBatches(Number(step.crafts || 0), { maxBatch });
            for (const amount of batches) {
                const result = await this.craft(step.recipeId, amount, { ...options, outputAmount, procedureStrategy: strategy, procedureMaxBatch: maxBatch });
                if (result?.success === false) return result;
                results.push(result?.data ?? result);
            }
            return Result.ok({ recipeId: step.recipeId, outputId: step.outputId, crafts: step.crafts, batches, results, procedureStrategy: strategy, procedureMaxBatch: maxBatch });
        } catch (error) {
            return Result.fail(this.#status(error), error.message, error, { recipeId: step.recipeId, outputId: step.outputId });
        }
    }

    async #legacyCraft(recipeId, amount, options) {
        try { return Result.ok(await this.operation.execute(recipeId, amount, options)); }
        catch (error) { return Result.fail(this.#status(error), error.message, error, { recipeId, amount }); }
    }

    #procedureBatchPolicy(recipeId, options = {}) {
        if (Number.isFinite(Number(options.maxBatch)) && Number(options.maxBatch) > 0) {
            return { maxBatch: Math.floor(Number(options.maxBatch)), strategy: options.strategy || null };
        }
        try {
            const recipe = this.recipeRegistry?.require?.(recipeId) || this.operation?.recipeRegistry?.require?.(recipeId) || null;
            const procedureId = recipe?.procedure || null;
            const procedure = procedureId && this.procedureRegistry?.get?.(procedureId) ? this.procedureRegistry.get(procedureId) : null;
            if (procedure && Number.isInteger(procedure.maxBatch) && procedure.maxBatch > 0) {
                return { maxBatch: procedure.maxBatch, strategy: procedure.quantityStrategy || null };
            }
        } catch { /* fail-closed to default batch below */ }
        return { maxBatch: 64, strategy: null };
    }

    #status(error) {
        return Operation.statusForError(error);
    }
}

module.exports = CraftingService;