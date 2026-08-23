'use strict';

const Operation = require('../../operations/Operation');
const Result = require('../../shared/result/Result');

class SmeltingService {
    constructor({ operation, operationManager = null, context = null }) {
        this.operation = operation;
        this.operationManager = operationManager;
        this.context = context;
    }

    isAvailable(recipeId) {
        return this.operation.isAvailable?.(recipeId) !== false;
    }

    async smelt(recipeId, options = {}) {
        if (!this.operationManager) {
            try {
                return Result.ok(await this.operation.execute(recipeId, options));
            } catch (error) {
                return Result.fail(Operation.statusForError(error), error.message, error);
            }
        }

        const generation = options.expectedGeneration
            ?? options.operationContext?.connectionGeneration
            ?? this.context?.getGeneration?.()
            ?? null;
        const operation = new Operation({
            name: 'SmeltingOperation',
            lockKeys: ['gui', 'storage'],
            execute: context => this.operation.execute(recipeId, {
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
            metadata: { subsystem: 'smelting', recipeId }
        });
    }
}

module.exports = SmeltingService;