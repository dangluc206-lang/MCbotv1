'use strict';

const FlowError = require('../../../../shared/errors/FlowError');

class StageExecutionContract {
    constructor({ logger = null } = {}) {
        this.logger = logger;
    }

    requireInputReady({ stage, logicalId, available, required, context = null }) {
        const actual = Number(available);
        const need = Math.max(0, Number(required) || 0);
        if (!Number.isFinite(actual) || actual < need) {
            throw new FlowError(`${stage} input is not ready for ${logicalId} (${Number.isFinite(actual) ? actual : 'unknown'}/${need}).`, {
                code: 'B5_STAGE_INPUT_NOT_READY', subsystem: 'b5', step: 'stage-input-ready', action: 'verify stage input', resource: logicalId,
                retryable: true, details: { stage, logicalId, available: Number.isFinite(actual) ? actual : null, required: need }, trace: context?.trace
            });
        }
        this.logger?.debug?.('B5 STAGE INPUT READY', { stage, logicalId, available: actual, required: need });
        return { stage, logicalId, available: actual, required: need };
    }

    verifyOutput({ stage, logicalId, before, after, expectedDelta, context = null }) {
        const b = Number(before);
        const a = Number(after);
        const expected = Math.max(1, Number(expectedDelta) || 1);
        const delta = Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, a - b) : 0;
        if (!Number.isFinite(a) || !Number.isFinite(b) || delta < expected) {
            throw new FlowError(`${stage} output was not verified for ${logicalId}.`, {
                code: 'B5_STAGE_OUTPUT_UNVERIFIED', subsystem: 'b5', step: 'stage-output-verified', action: 'verify stage output delta', resource: logicalId,
                retryable: true, details: { stage, logicalId, before: Number.isFinite(b) ? b : null, after: Number.isFinite(a) ? a : null, expectedDelta: expected, actualDelta: delta }, trace: context?.trace
            });
        }
        this.logger?.debug?.('B5 STAGE OUTPUT VERIFIED', { stage, logicalId, before: b, after: a, expectedDelta: expected, actualDelta: delta });
        return { stage, logicalId, before: b, after: a, expectedDelta: expected, actualDelta: delta };
    }

    requireSettled({ stage, logicalId, settlement, context = null }) {
        if (!settlement?.settled) {
            throw new FlowError(`${stage} inventory did not settle for ${logicalId}.`, {
                code: 'B5_STAGE_SETTLEMENT_TIMEOUT', subsystem: 'b5', step: 'stage-settlement', action: 'wait for relevant inventory settlement', resource: logicalId,
                retryable: true, details: { stage, logicalId, settlement: settlement || null }, trace: context?.trace
            });
        }
        this.logger?.debug?.('B5 STAGE SETTLED', { stage, logicalId, count: settlement.count, elapsedMs: settlement.elapsedMs });
        return settlement;
    }

    handoff({ from, to, generation = null, context = null }) {
        if (context?.connectionGeneration != null && generation != null
            && Number(context.connectionGeneration) !== Number(generation)) {
            throw new FlowError(`Cannot hand off ${from} to ${to} across connection generations.`, {
                code: 'B5_STAGE_STALE_GENERATION', subsystem: 'b5', step: 'stage-handoff', action: 'validate generation before next stage', resource: from,
                retryable: true, details: { from, to, expectedGeneration: generation, actualGeneration: context.connectionGeneration }, trace: context?.trace
            });
        }
        this.logger?.info?.('B5 STAGE HANDOFF READY', { from, to, generation });
        return { ready: true, from, to, generation };
    }
}

module.exports = StageExecutionContract;
