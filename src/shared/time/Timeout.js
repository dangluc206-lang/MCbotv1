'use strict';
const TimeoutError = require('../errors/TimeoutError');
const OperationCancelledError = require('../errors/OperationCancelledError');

function validateMilliseconds(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new TypeError('milliseconds must be a finite non-negative number');
}

class Timeout {
    static delay(milliseconds, options = {}) {
        validateMilliseconds(milliseconds);
        const token = options.cancellationToken;
        if (token?.isCancelled) return Promise.reject(new OperationCancelledError(String(token.reason || 'Operation cancelled.')));
        return new Promise((resolve, reject) => {
            let done = false;
            let unsubscribe = () => {};
            const cleanup = () => { clearTimeout(timer); unsubscribe(); };
            const finish = callback => value => { if (done) return; done = true; cleanup(); callback(value); };
            const timer = setTimeout(finish(resolve), milliseconds);
            if (token) unsubscribe = token.onCancelled(finish(reason => reject(new OperationCancelledError(String(reason || 'Operation cancelled.')))));
        });
    }
    static withTimeout(promise, milliseconds, options = {}) {
        validateMilliseconds(milliseconds);
        const token = options.cancellationToken;
        if (token?.isCancelled) return Promise.reject(new OperationCancelledError(String(token.reason || 'Operation cancelled.')));
        return new Promise((resolve, reject) => {
            let done = false;
            let unsubscribe = () => {};
            const cleanup = () => { clearTimeout(timer); unsubscribe(); };
            const settle = callback => value => { if (done) return; done = true; cleanup(); callback(value); };
            const timer = setTimeout(settle(() => reject(new TimeoutError(options.message || `Timed out after ${milliseconds} ms.`, { details: { milliseconds } }))), milliseconds);
            if (token) unsubscribe = token.onCancelled(settle(reason => reject(new OperationCancelledError(String(reason || 'Operation cancelled.')))));
            Promise.resolve(promise).then(settle(resolve), settle(reject));
        });
    }
}
module.exports = Timeout;
