'use strict';

const OperationCancelledError = require('../shared/errors/OperationCancelledError');

class VirtualClock {
    constructor({ startMs = 0 } = {}) {
        if (!Number.isFinite(startMs)) throw new TypeError('startMs must be finite');
        this.currentMs = Number(startMs);
        this.sequence = 0;
        this.tasks = [];
        this.pending = new Set();
        this.failures = [];
        this.disposed = false;
    }

    now() {
        return this.currentMs;
    }

    schedule(callback, delayMs = 0, { label = null, onCancel = null } = {}) {
        if (this.disposed) throw new Error('VirtualClock is disposed.');
        if (typeof callback !== 'function') throw new TypeError('callback must be a function');
        if (!Number.isFinite(delayMs) || delayMs < 0) throw new TypeError('delayMs must be a non-negative finite number');
        const task = {
            id: ++this.sequence,
            dueAt: this.currentMs + Number(delayMs),
            order: this.sequence,
            callback,
            label: label ? String(label) : null,
            onCancel: typeof onCancel === 'function' ? onCancel : null
        };
        this.tasks.push(task);
        this.#sort();
        return task.id;
    }

    clear(taskId, reason = 'Virtual clock task cancelled.') {
        const index = this.tasks.findIndex(task => task.id === taskId);
        if (index < 0) return false;
        const [task] = this.tasks.splice(index, 1);
        task.onCancel?.(reason);
        return true;
    }

    delay(delayMs, { cancellationToken = null, label = 'delay' } = {}) {
        cancellationToken?.throwIfCancelled?.();
        return new Promise((resolve, reject) => {
            let unsubscribe = () => {};
            let settled = false;
            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                unsubscribe();
                unsubscribe = () => {};
                callback(value);
            };
            const taskId = this.schedule(
                () => finish(resolve),
                delayMs,
                {
                    label,
                    onCancel: reason => finish(reject, new OperationCancelledError(String(reason || 'Virtual delay cancelled.')))
                }
            );
            if (cancellationToken?.onCancelled) {
                unsubscribe = cancellationToken.onCancelled(reason => {
                    if (!this.clear(taskId, reason)) {
                        finish(reject, new OperationCancelledError(String(reason || 'Virtual delay cancelled.')));
                    }
                });
            }
        });
    }

    async advanceBy(milliseconds) {
        if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new TypeError('milliseconds must be a non-negative finite number');
        return this.advanceTo(this.currentMs + Number(milliseconds));
    }

    async advanceTo(targetMs, { maxTasks = 100000 } = {}) {
        if (!Number.isFinite(targetMs) || targetMs < this.currentMs) throw new TypeError('targetMs must be finite and >= current time');
        let executed = 0;
        while (this.tasks[0] && this.tasks[0].dueAt <= targetMs) {
            if (++executed > maxTasks) throw new Error(`VirtualClock exceeded ${maxTasks} tasks.`);
            await this.runNext();
        }
        this.currentMs = Number(targetMs);
        await this.#flushMicrotasks();
        this.#throwFailure();
        return executed;
    }

    async runNext() {
        if (this.disposed) throw new Error('VirtualClock is disposed.');
        const task = this.tasks.shift();
        if (!task) return null;
        this.currentMs = Math.max(this.currentMs, task.dueAt);
        let outcome;
        try {
            outcome = task.callback();
        } catch (error) {
            this.failures.push(error);
        }
        if (outcome && typeof outcome.then === 'function') this.#track(outcome);
        await this.#flushMicrotasks();
        this.#throwFailure();
        return Object.freeze({ id: task.id, dueAt: task.dueAt, label: task.label });
    }

    async runAll({ maxTasks = 100000 } = {}) {
        let executed = 0;
        while (this.tasks.length > 0 || this.pending.size > 0) {
            if (this.tasks.length > 0) {
                if (++executed > maxTasks) throw new Error(`VirtualClock exceeded ${maxTasks} tasks.`);
                await this.runNext();
                continue;
            }
            await Promise.race([...this.pending]);
            await this.#flushMicrotasks();
            this.#throwFailure();
        }
        return executed;
    }

    pendingSnapshot() {
        return Object.freeze(this.tasks.map(task => Object.freeze({
            id: task.id,
            dueAt: task.dueAt,
            label: task.label
        })));
    }

    dispose(reason = 'Virtual clock disposed.') {
        if (this.disposed) return false;
        this.disposed = true;
        const tasks = this.tasks.splice(0);
        for (const task of tasks) task.onCancel?.(reason);
        return true;
    }

    #track(promise) {
        let observed;
        observed = Promise.resolve(promise).then(
            () => { this.pending.delete(observed); },
            error => {
                this.pending.delete(observed);
                this.failures.push(error);
            }
        );
        this.pending.add(observed);
    }

    #sort() {
        this.tasks.sort((left, right) => left.dueAt - right.dueAt || left.order - right.order);
    }

    async #flushMicrotasks() {
        await Promise.resolve();
        await Promise.resolve();
    }

    #throwFailure() {
        if (this.failures.length === 0) return;
        const [first] = this.failures.splice(0);
        throw first;
    }
}

module.exports = VirtualClock;
