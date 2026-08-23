'use strict';

const FlowError = require('../shared/errors/FlowError');
const OperationCancelledError = require('../shared/errors/OperationCancelledError');

class OperationQueue {
    constructor({ maxPending = 128, clock = Date.now } = {}) {
        if (!Number.isInteger(maxPending) || maxPending < 1) throw new TypeError('maxPending must be a positive integer');
        this.maxPending = maxPending;
        this.clock = clock;
        this.closed = false;
        this.entries = [];
        this.runningEntry = null;
        this.sequence = 0;
        this.drainWaiters = new Set();
    }

    get pending() { return this.entries.length; }
    get running() { return this.runningEntry ? 1 : 0; }

    enqueue(task, { id = null, cancellationToken = null, queueWaitTimeoutMs = null } = {}) {
        if (typeof task !== 'function') return Promise.reject(new TypeError('queue task must be a function'));
        if (this.closed) return Promise.reject(this.#flow('OPERATION_MANAGER_CLOSED', 'Operation queue is closed.'));
        if (this.entries.length >= this.maxPending) return Promise.reject(this.#flow('OPERATION_QUEUE_FULL', 'Operation queue is full.'));
        const entryId = id || `queue:${++this.sequence}`;
        return new Promise((resolve, reject) => {
            const entry = { id: entryId, task, resolve, reject, cancellationToken, enqueuedAt: Number(this.clock()), timer: null, unsubscribe: () => {}, settled: false };
            if (cancellationToken?.isCancelled) {
                reject(new OperationCancelledError(String(cancellationToken.reason || 'Operation cancelled.')));
                return;
            }
            if (Number.isFinite(queueWaitTimeoutMs) && queueWaitTimeoutMs >= 0) {
                entry.timer = setTimeout(() => {
                    if (!this.#removePending(entry)) return;
                    this.#settle(entry, 'reject', this.#flow('OPERATION_QUEUE_WAIT_TIMEOUT', 'Operation queue wait timed out.', { queueWaitMs: Number(this.clock()) - entry.enqueuedAt }));
                }, queueWaitTimeoutMs);
            }
            if (cancellationToken?.onCancelled) {
                entry.unsubscribe = cancellationToken.onCancelled(reason => {
                    if (!this.#removePending(entry)) return;
                    this.#settle(entry, 'reject', new OperationCancelledError(String(reason || 'Operation cancelled.')));
                });
            }
            this.entries.push(entry);
            this.#pump();
        });
    }

    cancel(id, reason = 'Operation cancelled.') {
        const entry = this.entries.find(candidate => candidate.id === id);
        if (!entry) return false;
        this.#removePending(entry);
        this.#settle(entry, 'reject', new OperationCancelledError(String(reason)));
        return true;
    }

    cancelAll(reason = 'Operation queue cancelled.') {
        const entries = [...this.entries];
        this.entries.length = 0;
        for (const entry of entries) this.#settle(entry, 'reject', new OperationCancelledError(String(reason)));
        this.#notifyDrain();
        return entries.length;
    }

    close() { this.closed = true; }
    async drain() { if (this.runningEntry || this.entries.length) await new Promise(resolve => this.drainWaiters.add(resolve)); }

    snapshot() {
        return Object.freeze({ closed: this.closed, pending: this.entries.length, running: this.runningEntry ? 1 : 0,
            pendingIds: Object.freeze(this.entries.map(entry => entry.id)), runningId: this.runningEntry?.id || null });
    }

    async destroy() { this.close(); this.cancelAll('Operation queue destroyed.'); await this.drain(); }

    #pump() {
        if (this.runningEntry || this.entries.length === 0) return;
        const entry = this.entries.shift();
        this.runningEntry = entry;
        this.#cleanupEntryWait(entry);
        Promise.resolve().then(() => entry.task()).then(
            value => this.#settle(entry, 'resolve', value),
            error => this.#settle(entry, 'reject', error)
        ).finally(() => {
            if (this.runningEntry === entry) this.runningEntry = null;
            this.#pump();
            this.#notifyDrain();
        });
    }

    #removePending(entry) { const index = this.entries.indexOf(entry); if (index < 0) return false; this.entries.splice(index, 1); return true; }
    #cleanupEntryWait(entry) { if (entry.timer) clearTimeout(entry.timer); entry.timer = null; entry.unsubscribe(); entry.unsubscribe = () => {}; }
    #settle(entry, kind, value) { if (entry.settled) return; entry.settled = true; this.#cleanupEntryWait(entry); entry[kind](value); this.#notifyDrain(); }
    #notifyDrain() { if (this.runningEntry || this.entries.length) return; for (const resolve of this.drainWaiters) resolve(); this.drainWaiters.clear(); }
    #flow(code, message, details = null) { return new FlowError(message, { code, subsystem: 'operation', operation: 'OperationQueue', retryable: true, details }); }
}

module.exports = OperationQueue;