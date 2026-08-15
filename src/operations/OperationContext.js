'use strict';

const CancellationSource = require('../shared/cancellation/CancellationSource');
const StepRunner = require('../shared/flow/StepRunner');

class OperationContext {
    constructor({ operationId, botId, timeoutMs = 30000, metadata = null, logger = null }) {
        this.operationId = operationId;
        this.botId = botId;
        this.timeoutMs = timeoutMs;
        this.metadata = metadata;
        this.startedAt = Date.now();
        this.cancellation = new CancellationSource();
        this.locks = new Set();
        this.trace = [];
        this.steps = new StepRunner({ operation: operationId, logger, trace: this.trace });
    }

    cancel(reason) { return this.cancellation.cancel(reason); }

    step(meta, action, options = {}) {
        const enriched = typeof meta === 'string'
            ? { step: meta, operation: this.metadata?.operation || this.operationId }
            : { operation: this.metadata?.operation || this.operationId, ...(meta || {}) };
        return this.steps.run(enriched, action, {
            cancellationToken: this.cancellation.token,
            ...options
        });
    }

    diagnostic() {
        return {
            operationId: this.operationId,
            botId: this.botId,
            timeoutMs: this.timeoutMs,
            elapsedMs: Date.now() - this.startedAt,
            metadata: this.metadata,
            trace: this.trace
        };
    }

    dispose() { this.cancellation.dispose(); }
}

module.exports = OperationContext;
