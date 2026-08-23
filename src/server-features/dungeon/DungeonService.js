'use strict';

const Operation = require('../../operations/Operation');
const Result = require('../../shared/result/Result');

class DungeonService {
    constructor({ operation, operationManager = null, context = null }) {
        this.operation = operation;
        this.operationManager = operationManager;
        this.context = context;
    }

    async enter(destinationId, options = {}) {
        if (!this.operationManager) {
            try { return Result.ok(await this.operation.execute(destinationId, options)); }
            catch (error) {
                return Result.fail(Operation.statusForError(error), error.message, error, { destinationId });
            }
        }

        const expectedGeneration = options.expectedGeneration
            ?? options.operationContext?.connectionGeneration
            ?? this.context?.getGeneration?.()
            ?? null;
        const rootOperation = new Operation({
            name: 'DungeonTeleportOperation',
            lockKeys: ['gui', 'movement', 'teleport'],
            execute: operationContext => this.operation.execute(destinationId, {
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
            metadata: { subsystem: 'dungeon', destinationId }
        });
    }
}

module.exports = DungeonService;