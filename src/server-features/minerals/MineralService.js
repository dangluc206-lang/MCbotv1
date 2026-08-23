'use strict';

const Operation = require('../../operations/Operation');
const Result = require('../../shared/result/Result');

class MineralService {
    constructor({ operation, operationManager = null, context = null }) {
        this.operation = operation;
        this.operationManager = operationManager;
        this.context = context;
    }

    isAvailable(baseId, direction = 'toBlock') {
        return this.operation.isAvailable?.(baseId, direction) !== false;
    }

    async convert(baseId, options = {}) {
        if (!this.operationManager) {
            try {
                return Result.ok(await this.operation.execute(baseId, options));
            } catch (error) {
                return Result.fail(Operation.statusForError(error), error.message, error, {
                    baseId,
                    direction: options.direction || 'toBlock'
                });
            }
        }

        const generation = options.expectedGeneration
            ?? options.operationContext?.connectionGeneration
            ?? this.context?.getGeneration?.()
            ?? null;
        const operation = new Operation({
            name: 'MineralConversionOperation',
            lockKeys: ['gui', 'storage'],
            execute: context => this.operation.execute(baseId, {
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
            metadata: {
                subsystem: 'mineral-conversion',
                baseId,
                direction: options.direction || 'toBlock'
            }
        });
    }

    toBlocks(baseId, options = {}) {
        return this.convert(baseId, { ...options, direction: 'toBlock' });
    }

    toBase(baseId, options = {}) {
        return this.convert(baseId, { ...options, direction: 'toBase' });
    }
}

module.exports = MineralService;