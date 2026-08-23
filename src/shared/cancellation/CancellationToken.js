'use strict';
const OperationCancelledError = require('../errors/OperationCancelledError');

class CancellationToken {
    #cancelled = false;
    #reason = null;
    #listeners = new Set();
    #listenerErrors = [];
    #listenerErrorLimit = 8;

    constructor({ listenerErrorLimit = 8 } = {}) {
        if (!Number.isInteger(listenerErrorLimit) || listenerErrorLimit < 0) {
            throw new TypeError('CancellationToken listenerErrorLimit must be a non-negative integer.');
        }
        this.#listenerErrorLimit = listenerErrorLimit;
    }

    get isCancelled() { return this.#cancelled; }
    get reason() { return this.#reason; }
    get listenerErrors() {
        return Object.freeze(this.#listenerErrors.map(entry => Object.freeze({ ...entry })));
    }
    throwIfCancelled() {
        if (this.#cancelled) throw new OperationCancelledError(String(this.#reason || 'Operation cancelled.'), { details: { reason: this.#reason } });
    }
    onCancelled(listener) {
        if (typeof listener !== 'function') throw new TypeError('listener must be a function');
        if (this.#cancelled) {
            queueMicrotask(() => {
                try {
                    listener(this.#reason);
                } catch (error) {
                    this.#recordListenerError(error, 'late-listener');
                }
            });
            return () => {};
        }
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }
    _cancel(reason = 'Cancelled') {
        if (this.#cancelled) return false;
        this.#cancelled = true;
        this.#reason = reason;
        const listeners = [...this.#listeners];
        this.#listeners.clear();
        for (const listener of listeners) {
            try {
                listener(reason);
            } catch (error) {
                this.#recordListenerError(error, 'cancel-listener');
            }
        }
        return true;
    }
    _dispose() { this.#listeners.clear(); }

    #recordListenerError(error, phase) {
        if (this.#listenerErrorLimit === 0) return;
        this.#listenerErrors.push(Object.freeze({
            phase,
            name: error?.name || 'Error',
            code: error?.code || null,
            message: error?.message || String(error)
        }));
        if (this.#listenerErrors.length > this.#listenerErrorLimit) {
            this.#listenerErrors.splice(0, this.#listenerErrors.length - this.#listenerErrorLimit);
        }
    }
}
module.exports = CancellationToken;
