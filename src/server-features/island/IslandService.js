'use strict';

const Result = require('../../shared/result/Result');
const Operation = require('../../operations/Operation');

class IslandService {
    constructor({ operation, operationManager = null, context = null }) {
        this.operation = operation;
        this.operationManager = operationManager;
        this.context = context;
    }

    async goHome({
        cancellationToken = null,
        expectedGeneration = null,
        operationContext = null,
        timeoutMs = null,
        correlationId = null
    } = {}) {
        const generation = expectedGeneration
            ?? operationContext?.connectionGeneration
            ?? this.context?.getGeneration?.()
            ?? null;
        if (this.operationManager) {
            const managed = new Operation({
                name: 'IslandService.goHome',
                lockKeys: ['server-command', 'movement', 'teleport'],
                execute: context => this.operation.execute({
                    cancellationToken: context.cancellation.token,
                    expectedGeneration: context.connectionGeneration,
                    operationContext: context
                })
            });
            return this.operationManager.run(managed, {
                operationContext,
                cancellationToken,
                connectionGeneration: generation,
                timeoutMs: timeoutMs ?? undefined,
                correlationId,
                metadata: { subsystem: 'island', action: 'go-home' }
            });
        }
        try {
            return Result.ok(await this.operation.execute({ cancellationToken, expectedGeneration: generation, operationContext }));
        } catch (error) {
            return Result.fail(Operation.statusForError(error), error.message, error);
        }
    }
}

module.exports = IslandService;