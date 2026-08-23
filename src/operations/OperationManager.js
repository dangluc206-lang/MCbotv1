'use strict';

const OperationContext = require('./OperationContext');
const Operation = require('./Operation');
const Result = require('../shared/result/Result');
const Status = require('../shared/result/Status');
const FlowError = require('../shared/errors/FlowError');

class OperationManager {
    constructor({ botId, queue, lockPolicy, timeoutPolicy, logger = null, config = {}, clock = Date.now }) {
        Object.assign(this, { botId, queue, lockPolicy, timeoutPolicy, logger, clock });
        this.sequence = 0;
        this.active = new Map();
        this.authority = Object.freeze({ manager: Symbol(botId) });
        this.managerId = Symbol(`OperationManager:${botId}`);
        this.config = Object.freeze({
            defaultQueueWaitTimeoutMs: Number(config.defaultQueueWaitTimeoutMs ?? 5000),
            defaultExecutionTimeoutMs: Number(config.defaultExecutionTimeoutMs ?? 30000),
            shutdownDrainTimeoutMs: Number(config.shutdownDrainTimeoutMs ?? 5000)
        });
    }

    run(operation, { timeoutMs = this.config.defaultExecutionTimeoutMs, queueWaitTimeoutMs = this.config.defaultQueueWaitTimeoutMs, metadata = null, cancellationToken = null, connectionGeneration = null, expectedGeneration = connectionGeneration, correlationId = null, operationContext = null } = {}) {
        if (!operation || typeof operation.run !== 'function') return Promise.resolve(Result.fail(Status.INVALID_INPUT, 'operation.run is required'));
        if (operationContext) return this.#runChild(operation, operationContext, { timeoutMs, metadata, connectionGeneration: expectedGeneration, correlationId });
        return this.#runRoot(operation, { timeoutMs, queueWaitTimeoutMs, metadata, cancellationToken, connectionGeneration: expectedGeneration, correlationId });
    }

    isContext(value) { return this.#isLiveContext(value); }
    cancel(operationId, reason = 'Operation cancelled.') { const context = this.active.get(operationId); return Boolean(context?.cancel(reason) || this.queue.cancel?.(operationId, reason)); }
    cancelAll(reason = 'Operations cancelled.') { let cancelled = 0; for (const context of this.active.values()) if (context.cancel(reason)) cancelled += 1; this.queue.cancelAll?.(reason); return cancelled; }

    snapshot() {
        const queueSnapshot = this.queue.snapshot?.() || { pending: Number(this.queue.pending || 0), running: 0, closed: false };
        const operations = [...this.active.values()].map(context => context.diagnostic());
        return Object.freeze({ active: operations.length, pending: queueSnapshot.pending, running: queueSnapshot.running, closed: Boolean(queueSnapshot.closed), operationIds: Object.freeze(operations.map(operation => operation.operationId)), operations: Object.freeze(operations) });
    }

    async stop() {
        this.cancelAll('Runtime stopping');
        this.queue.close();
        const drain = this.queue.drain();
        let timer = null;
        const timeout = new Promise(resolve => {
            timer = setTimeout(() => resolve('timeout'), Math.max(0, this.config.shutdownDrainTimeoutMs));
        });
        const result = await Promise.race([drain.then(() => 'drained'), timeout]);
        if (timer) clearTimeout(timer);
        if (result === 'timeout') {
            this.logger?.warn?.('Operation manager drain timed out.', {
                botId: this.botId,
                snapshot: this.snapshot(),
                locks: this.lockPolicy.snapshot()
            });
        }
    }
    async destroy() { await this.stop(); }

    async #runRoot(operation, options) {
        const operationId = `${this.botId}:${++this.sequence}`;
        const context = this.#createContext({ operationId, operationName: operation.name || options.metadata?.operation || 'Operation', timeoutMs: options.timeoutMs, queueWaitTimeoutMs: options.queueWaitTimeoutMs, metadata: options.metadata, connectionGeneration: options.connectionGeneration, correlationId: options.correlationId || operationId, lockOwner: this.lockPolicy.createOwner(`lock:${operationId}`) });
        const externalUnsubscribe = options.cancellationToken?.onCancelled?.(reason => context.cancel(reason)) || (() => {});
        this.active.set(operationId, context);
        let result;
        try {
            result = await this.queue.enqueue(async () => { context.markRunning(); return operation.run(context, { lockPolicy: this.lockPolicy, timeoutPolicy: this.timeoutPolicy }); }, { id: operationId, cancellationToken: context.cancellation.token, queueWaitTimeoutMs: options.queueWaitTimeoutMs });
            context.markSettled(this.#contextStatus(result));
        } catch (error) {
            const status = Operation.statusForError(error);
            context.markSettled(this.#contextStatusFromStatus(status));
            const wrapped = FlowError.wrap(error, { code: error?.code || status, subsystem: 'operation', operation: operation.name || 'OperationManager', details: context.diagnostic() });
            result = Result.fail(status, wrapped.message, wrapped, wrapped.toDiagnostic());
        } finally {
            externalUnsubscribe();
            await context.runCleanups();
            context.dispose();
            this.active.delete(operationId);
        }
        return this.#withContextMeta(result, context);
    }

    async #runChild(operation, parent, options) {
        const authorized = OperationContext.isAuthorized(parent, this.authority, this.managerId, this.botId);
        if (!authorized) {
            const error = new FlowError('Invalid operationContext.', { code: 'OPERATION_CONTEXT_INVALID', subsystem: 'operation', operation: operation.name || 'OperationManager', retryable: false });
            return Result.fail(Status.INVALID_INPUT, error.message, error, error.toDiagnostic());
        }
        if (parent.cancellation?.token?.isCancelled && this.active.get(parent.operationId) === parent) {
            try {
                parent.throwIfCancelled();
            } catch (error) {
                const wrapped = FlowError.wrap(error, { code: error?.code || 'CANCELLED', subsystem: 'operation', operation: operation.name || 'OperationManager', details: parent.diagnostic() });
                return Result.fail(Status.CANCELLED, wrapped.message, wrapped, wrapped.toDiagnostic());
            }
        }
        if (!this.#isLiveContext(parent)) {
            const error = new FlowError('Operation context is stale or no longer owns an active root.', {
                code: 'OPERATION_CONTEXT_STALE', subsystem: 'operation', operation: operation.name || 'OperationManager', retryable: false,
                details: { operationId: parent.operationId, rootOperationId: parent.rootOperationId, status: parent.status, settledAt: parent.settledAt }
            });
            return Result.fail(Status.INVALID_INPUT, error.message, error, error.toDiagnostic());
        }
        let context = null;
        let result;
        try {
            parent.throwIfCancelled();
            if (options.connectionGeneration != null && parent.connectionGeneration != null && Number(options.connectionGeneration) !== Number(parent.connectionGeneration)) {
                const error = new FlowError('Child operation generation does not match parent.', { code: 'OPERATION_CHILD_STALE_GENERATION', subsystem: 'operation', operation: operation.name || 'OperationManager', retryable: true, details: { parentGeneration: parent.connectionGeneration, childGeneration: options.connectionGeneration } });
                return Result.fail(Status.DISCONNECTED, error.message, error, error.toDiagnostic());
            }
            const parentRemaining = parent.remainingMs();
            const configured = options.timeoutMs == null ? null : Number(options.timeoutMs);
            const configuredTimeout = configured != null && Number.isFinite(configured) && configured >= 0
                ? configured
                : null;
            const timeoutMs = parentRemaining == null
                ? configuredTimeout
                : (configuredTimeout == null ? parentRemaining : Math.min(configuredTimeout, parentRemaining));
            const operationId = `${parent.rootOperationId}/child:${++this.sequence}`;
            context = this.#createContext({ operationId, operationName: operation.name || options.metadata?.operation || 'ChildOperation', timeoutMs, queueWaitTimeoutMs: 0, metadata: options.metadata, connectionGeneration: parent.connectionGeneration ?? options.connectionGeneration, correlationId: options.correlationId || parent.correlationId, parent, lockOwner: parent.lockOwner, trace: parent.trace });
            context.markRunning();
            this.active.set(operationId, context);
            result = await operation.run(context, { lockPolicy: this.lockPolicy, timeoutPolicy: this.timeoutPolicy });
            context.markSettled(this.#contextStatus(result));
        } catch (error) {
            const status = Operation.statusForError(error);
            if (context) context.markSettled(this.#contextStatusFromStatus(status));
            const wrapped = FlowError.wrap(error, {
                code: error?.code || status,
                subsystem: 'operation',
                operation: operation.name || 'OperationManager',
                details: context?.diagnostic?.() || parent.diagnostic()
            });
            result = Result.fail(status, wrapped.message, wrapped, wrapped.toDiagnostic());
        } finally {
            if (context) {
                await context.runCleanups();
                context.dispose();
                this.active.delete(context.operationId);
            }
        }
        return context ? this.#withContextMeta(result, context) : result;
    }


    #isLiveContext(context) {
        if (!OperationContext.isAuthorized(context, this.authority, this.managerId, this.botId)) return false;
        if (!context.isLive?.()) return false;
        if (this.active.get(context.operationId) !== context) return false;
        const root = this.active.get(context.rootOperationId);
        if (!root || !OperationContext.isAuthorized(root, this.authority, this.managerId, this.botId)) return false;
        if (!root.isLive?.()) return false;
        return true;
    }

    #createContext(options) { return new OperationContext({ authority: this.authority, managerId: this.managerId, botId: this.botId, logger: this.logger, clock: this.clock, ...options }); }
    #withContextMeta(result, context) { if (!result || typeof result !== 'object') return result; const meta = { ...(result.meta || {}), ...context.diagnostic() }; return result.success ? Result.ok(result.data, meta) : Result.fail(result.status, result.message, result.error, meta); }
    #contextStatus(result) { return this.#contextStatusFromStatus(result?.status); }
    #contextStatusFromStatus(status) { if (status === Status.SUCCESS) return 'SUCCEEDED'; if (status === Status.CANCELLED) return 'CANCELLED'; if (status === Status.TIMEOUT) return 'TIMED_OUT'; return 'FAILED'; }
}

module.exports = OperationManager;