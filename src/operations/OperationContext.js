'use strict';

const CancellationSource = require('../shared/cancellation/CancellationSource');
const StepRunner = require('../shared/flow/StepRunner');
const { immutableClone } = require('../shared/utils/object');

const AUTHORITY = Symbol('OperationContextAuthority');

class OperationContext {
    #disposed = false;

    constructor({
        authority,
        managerId,
        operationId,
        operationName,
        botId,
        connectionGeneration = null,
        correlationId = null,
        timeoutMs = 30000,
        queueWaitTimeoutMs = 5000,
        metadata = null,
        logger = null,
        parent = null,
        lockOwner = null,
        clock = Date.now,
        trace = null
    }) {
        if (!authority) throw new TypeError('OperationContext authority is required');
        this[AUTHORITY] = authority;
        this.managerId = managerId;
        this.operationId = operationId;
        this.operationName = operationName || operationId;
        this.botId = botId;
        this.connectionGeneration = connectionGeneration == null ? null : Number(connectionGeneration);
        this.correlationId = correlationId || operationId;
        this.timeoutMs = timeoutMs == null ? null : Number(timeoutMs);
        this.queueWaitTimeoutMs = Number(queueWaitTimeoutMs);
        this.metadata = immutableClone(metadata);
        this.clock = clock;
        this.enqueuedAt = Number(clock());
        this.startedAt = null;
        this.settledAt = null;
        this.status = 'QUEUED';
        this.parentOperationId = parent?.operationId || null;
        this.rootOperationId = parent?.rootOperationId || operationId;
        if (!lockOwner) throw new TypeError('OperationContext lockOwner is required');
        this.lockOwner = lockOwner;
        this.cancellation = new CancellationSource();
        this.trace = trace || [];
        this.steps = new StepRunner({ operation: this.operationName, logger, trace: this.trace });
        this.cleanups = [];
        this.cleanupErrors = [];
        this.parentUnsubscribe = parent?.cancellation?.token?.onCancelled?.(reason => this.cancel(reason)) || (() => {});
    }

    static isAuthorized(context, authority, managerId, botId) {
        return context instanceof OperationContext
            && context[AUTHORITY] === authority
            && context.managerId === managerId
            && context.botId === botId;
    }

    isLive() {
        return !this.#disposed
            && this.status === 'RUNNING'
            && this.settledAt === null
            && !this.cancellation.token.isCancelled;
    }

    isDisposed() { return this.#disposed; }

    markRunning() {
        if (this.status !== 'QUEUED') return;
        this.startedAt = Number(this.clock());
        this.status = 'RUNNING';
    }

    markSettled(status) {
        this.status = status;
        this.settledAt = Number(this.clock());
    }

    cancel(reason = 'Operation cancelled.') { return this.cancellation.cancel(reason); }
    throwIfCancelled() { this.cancellation.token.throwIfCancelled(); }

    remainingMs() {
        if (this.timeoutMs == null) return null;
        if (this.startedAt === null) return Math.max(0, this.timeoutMs);
        return Math.max(0, this.timeoutMs - (Number(this.clock()) - this.startedAt));
    }

    registerCleanup(cleanup, label = 'cleanup') {
        if (typeof cleanup !== 'function') throw new TypeError('cleanup must be a function');
        this.cleanups.push({ cleanup, label: String(label || 'cleanup') });
        return cleanup;
    }

    async runCleanups() {
        const errors = [];
        while (this.cleanups.length) {
            const entry = this.cleanups.pop();
            try { await entry.cleanup(); }
            catch (error) { errors.push({ label: entry.label, error }); }
        }
        this.cleanupErrors = errors;
        return errors;
    }

    step(meta, action, options = {}) {
        this.throwIfCancelled();
        const enriched = typeof meta === 'string'
            ? { step: meta, operation: this.operationName }
            : { operation: this.operationName, ...(meta || {}) };
        return this.steps.run(enriched, action, {
            cancellationToken: this.cancellation.token,
            ...options
        });
    }

    diagnostic() {
        const now = Number(this.clock());
        return immutableClone({
            operationId: this.operationId,
            operationName: this.operationName,
            botId: this.botId,
            connectionGeneration: this.connectionGeneration,
            correlationId: this.correlationId,
            parentOperationId: this.parentOperationId,
            rootOperationId: this.rootOperationId,
            status: this.status,
            enqueuedAt: this.enqueuedAt,
            startedAt: this.startedAt,
            settledAt: this.settledAt,
            queueWaitMs: this.startedAt === null ? Math.max(0, now - this.enqueuedAt) : Math.max(0, this.startedAt - this.enqueuedAt),
            timeoutMs: this.timeoutMs,
            queueWaitTimeoutMs: this.queueWaitTimeoutMs,
            remainingMs: this.remainingMs(),
            metadata: this.metadata,
            trace: this.trace,
            cleanupErrors: this.cleanupErrors.map(entry => ({ label: entry.label, message: entry.error?.message || String(entry.error) }))
        });
    }

    dispose() {
        if (this.#disposed) return;
        this.#disposed = true;
        this.parentUnsubscribe();
        this.parentUnsubscribe = () => {};
        this.cancellation.dispose();
    }
}

module.exports = OperationContext;