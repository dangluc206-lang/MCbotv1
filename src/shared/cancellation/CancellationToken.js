'use strict';
const OperationCancelledError = require('../errors/OperationCancelledError');

class CancellationToken {
    #cancelled = false;
    #reason = null;
    #listeners = new Set();
    get isCancelled() { return this.#cancelled; }
    get reason() { return this.#reason; }
    throwIfCancelled() {
        if (this.#cancelled) throw new OperationCancelledError(String(this.#reason || 'Operation cancelled.'), { details: { reason: this.#reason } });
    }
    onCancelled(listener) {
        if (typeof listener !== 'function') throw new TypeError('listener must be a function');
        if (this.#cancelled) {
            queueMicrotask(() => { try { listener(this.#reason); } catch {} });
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
            try { listener(reason); } catch {}
        }
        return true;
    }
    _dispose() { this.#listeners.clear(); }
}
module.exports = CancellationToken;
