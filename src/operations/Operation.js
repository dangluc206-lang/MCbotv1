'use strict';

const Result = require('../shared/result/Result');
const Status = require('../shared/result/Status');
const OperationStatus = require('./OperationStatus');
const FlowError = require('../shared/errors/FlowError');

class Operation {
    constructor({ name, lockKeys = [], execute, verify = null }) {
        if (typeof execute !== 'function') throw new TypeError('execute is required');
        this.name = name || 'Operation';
        this.lockKeys = [...lockKeys];
        this.executor = execute;
        this.verifier = verify;
        this.status = OperationStatus.PENDING;
    }

    async run(context, { lockPolicy, timeoutPolicy }) {
        if (!lockPolicy.acquire(this.lockKeys, context.operationId)) {
            return Result.fail(Status.BUSY, 'Required operation lock is busy.', null, {
                operation: this.name,
                operationId: context.operationId,
                locks: this.lockKeys
            });
        }
        context.locks = new Set(this.lockKeys);
        this.status = OperationStatus.RUNNING;
        try {
            const data = await timeoutPolicy.run(this.executor(context), context);
            if (this.verifier && !await this.verifier(data, context)) {
                this.status = OperationStatus.FAILED;
                const error = new FlowError('Operation verification failed.', {
                    code: 'OPERATION_VERIFICATION_FAILED',
                    subsystem: 'operation',
                    operation: this.name,
                    step: 'verify',
                    retryable: false,
                    details: context.diagnostic(),
                    trace: context.trace
                });
                return Result.fail(Status.VERIFICATION_FAILED, error.message, error, error.toDiagnostic());
            }
            this.status = OperationStatus.SUCCEEDED;
            return Result.ok(data, {
                operation: this.name,
                operationId: context.operationId,
                elapsedMs: Date.now() - context.startedAt
            });
        } catch (error) {
            this.status = error.code === 'TIMEOUT'
                ? OperationStatus.TIMED_OUT
                : error.code === 'CANCELLED'
                    ? OperationStatus.CANCELLED
                    : OperationStatus.FAILED;
            const wrapped = FlowError.wrap(error, {
                subsystem: error.subsystem || 'operation',
                operation: error.operation || this.name,
                details: {
                    operationId: context.operationId,
                    ...(error.details || {})
                },
                trace: error.trace?.length ? error.trace : context.trace
            });
            const status = error.code === 'TIMEOUT'
                ? Status.TIMEOUT
                : error.code === 'CANCELLED'
                    ? Status.CANCELLED
                    : Status.FAILED;
            return Result.fail(status, wrapped.message, wrapped, wrapped.toDiagnostic());
        } finally {
            lockPolicy.release(this.lockKeys, context.operationId);
            context.dispose();
        }
    }
}

module.exports = Operation;
