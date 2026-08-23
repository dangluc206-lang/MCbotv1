'use strict';

const Operation = require('../../operations/Operation');
const Result = require('../../shared/result/Result');

class SkyblockService {
    constructor({ operation, operationManager = null, context = null }) {
        if (!operation || typeof operation.execute !== 'function') throw new TypeError('skyblock operation is required');
        this.operation = operation;
        this.operationManager = operationManager;
        this.context = context;
    }

    async join(selectionId = null, options = {}) {
        if (!this.operationManager) {
            try { return Result.ok(await this.operation.execute(selectionId, options)); }
            catch (error) {
                return Result.fail(Operation.statusForError(error), error.message, error, { selectionId });
            }
        }
        const expectedGeneration = options.expectedGeneration
            ?? options.operationContext?.connectionGeneration
            ?? this.context?.getGeneration?.()
            ?? null;
        const rootOperation = new Operation({
            name: 'SkyblockJoinOperation',
            lockKeys: ['gui', 'movement', 'teleport'],
            execute: operationContext => this.operation.execute(selectionId, {
                ...options,
                operationContext,
                cancellationToken: operationContext.cancellation.token,
                expectedGeneration: operationContext.connectionGeneration
            })
        });
        return this.operationManager.run(rootOperation, {
            operationContext: options.operationContext || null,
            cancellationToken: options.cancellationToken || null,
            connectionGeneration: expectedGeneration,
            timeoutMs: options.timeoutMs,
            queueWaitTimeoutMs: options.queueWaitTimeoutMs,
            correlationId: options.correlationId || null,
            metadata: { subsystem: 'skyblock', selectionId }
        });
    }
}

module.exports = SkyblockService;