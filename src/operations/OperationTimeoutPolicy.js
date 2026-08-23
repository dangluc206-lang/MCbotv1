'use strict';

const TimeoutError = require('../shared/errors/TimeoutError');
const OperationCancelledError = require('../shared/errors/OperationCancelledError');

class OperationTimeoutPolicy {
    run(work, context) {
        if (typeof work !== 'function') throw new TypeError('OperationTimeoutPolicy.run requires a function');
        context.throwIfCancelled();
        const remainingMs = context.remainingMs();
        const hasDeadline = remainingMs != null;
        const timeoutMs = hasDeadline ? Math.max(0, Number(remainingMs)) : null;
        return new Promise((resolve, reject) => {
            let settled = false;
            let timer = null;
            let unsubscribe = () => {};
            const cleanup = () => { if (timer) clearTimeout(timer); unsubscribe(); };
            const finish = (callback, value) => { if (settled) return; settled = true; cleanup(); callback(value); };
            if (hasDeadline) {
                timer = setTimeout(() => {
                    if (settled) return;
                    const error = new TimeoutError(`Operation ${context.operationId} timed out.`, { code: 'TIMEOUT', details: { operationId: context.operationId, timeoutMs: context.timeoutMs } });
                    context.cancel({ code: 'TIMEOUT', message: error.message });
                    finish(reject, error);
                }, timeoutMs);
            }
            unsubscribe = context.cancellation.token.onCancelled(reason => {
                if (settled) return;
                if (reason && typeof reason === 'object' && reason.code === 'TIMEOUT') return;
                finish(reject, new OperationCancelledError(String(reason?.message || reason || 'Operation cancelled.')));
            });
            Promise.resolve().then(work).then(value => finish(resolve, value), error => finish(reject, error));
        });
    }
}

module.exports = OperationTimeoutPolicy;