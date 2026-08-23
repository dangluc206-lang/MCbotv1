'use strict';

const DecisionReplayEnvelope = require('../../../../shared/contracts/DecisionReplayEnvelope');
const TraceEnvelope = require('../../../../diagnostics/runtime/TraceEnvelope');

function compactStep(entry) {
    if (!entry || typeof entry !== 'object') return null;
    return {
        step: entry.step || null,
        action: entry.action || null,
        resource: entry.resource || null,
        attempt: Number(entry.attempt || 1),
        status: entry.status || null,
        elapsedMs: Number(entry.elapsedMs || 0),
        error: entry.error || null
    };
}

function replayFixtureFromPlan(plan) {
    if (!plan?.replayInput) return null;
    return Object.freeze({
        version: 1,
        inspection: plan.replayInput,
        expected: Object.freeze({
            decisionKind: plan.decision?.kind ?? null,
            decisionResource: plan.decision?.resource ?? null,
            blockers: Object.freeze((plan.blockers || []).map(entry => `${entry.reason}:${entry.resource || ''}`))
        })
    });
}

class B5TraceRecorder {
    constructor({ botId, serverProfile = null, historyLimit = 100, logger = null } = {}) {
        this.botId = botId || 'unknown';
        this.historyLimit = Math.max(10, Number(historyLimit) || 100);
        this.logger = logger;
        this.serverProfile = serverProfile ? Object.freeze({ id: serverProfile.id || null, revision: serverProfile.revision || null }) : null;
        this.sequence = 0;
        this.history = [];
    }

    recordResult(result, { mode = 'production', amount = 1 } = {}) {
        const data = result?.data || null;
        const trace = Array.isArray(result?.meta?.trace) ? result.meta.trace.map(compactStep).filter(Boolean) : [];
        const blockers = Array.isArray(data?.blockingReasons) ? data.blockingReasons : [];
        const plan = data?.plan || null;
        const replayFixture = replayFixtureFromPlan(plan);
        const replayEnvelope = replayFixture && (this.serverProfile?.id || result?.meta?.serverProfileId) ? DecisionReplayEnvelope.fromLegacyB5Fixture(replayFixture, {
            profile: { id: this.serverProfile?.id || result?.meta?.serverProfileId, revision: this.serverProfile?.revision || result?.meta?.serverProfileRevision || 'unknown' },
            policy: { id: 'b5-execution-planner', revision: `v${plan?.version || 1}` }
        }) : null;
        const traceId = `${this.botId}:b5:${++this.sequence}`;
        const traceEnvelope = TraceEnvelope.create({
            traceId, botId: this.botId, connectionGeneration: result?.meta?.connectionGeneration ?? null,
            operationId: result?.meta?.operationId || null, correlationId: result?.meta?.correlationId || result?.meta?.operationId || null,
            decisionDigest: replayEnvelope?.digest || null, kind: 'b5-cycle', code: result?.success === false ? (result?.error?.code || result?.status || 'FAILED') : 'SUCCESS',
            details: { mode, amount: Number(amount || 1), productive: Boolean(data?.productive), complete: Boolean(data?.completedNewB5 || data?.complete) }
        });
        const record = Object.freeze({
            traceId,
            operationId: result?.meta?.operationId || null,
            connectionGeneration: result?.meta?.connectionGeneration ?? null,
            serverProfileId: this.serverProfile?.id || result?.meta?.serverProfileId || null,
            serverProfileRevision: this.serverProfile?.revision || result?.meta?.serverProfileRevision || null,
            mode,
            amount: Number(amount || 1),
            success: result?.success !== false,
            status: result?.status || null,
            productive: Boolean(data?.productive || data?.completedNewB5 || data?.recoveredExistingB5),
            complete: Boolean(data?.completedNewB5 || data?.complete),
            plan: plan ? {
                version: plan.version || null,
                snapshotDigest: plan.snapshotDigest || null,
                state: plan.state || null,
                decision: plan.decision || null,
                blockers: plan.blockers || []
            } : null,
            blockers,
            replayFixture,
            replayEnvelope,
            traceEnvelope,
            actionSummary: data?.actionSummary || null,
            steps: Object.freeze(trace),
            error: result?.success === false ? {
                code: result?.error?.code || result?.status || null,
                message: result?.message || result?.error?.message || null
            } : null
        });
        this.history.push(record);
        if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit);
        if (record.error) {
            const cancelled = record.error.code === 'CANCELLED';
            const log = cancelled ? this.logger?.info : this.logger?.warn;
            log?.call(this.logger, cancelled ? 'B5 TRACE CANCELLED' : 'B5 TRACE FAILED', { traceId: record.traceId, error: record.error, plan: record.plan });
        }
        return record;
    }

    latest() { return this.history[this.history.length - 1] || null; }
    latestReplayFixture() { return this.latest()?.replayFixture || null; }
    latestReplayEnvelope() { return this.latest()?.replayEnvelope || null; }
    snapshot({ limit = 20 } = {}) { return Object.freeze(this.history.slice(-Math.max(1, Number(limit) || 20))); }
    clear() { this.history.length = 0; }
}

module.exports = B5TraceRecorder;
