'use strict';

const CancellationSource = require('../shared/cancellation/CancellationSource');
const Timeout = require('../shared/time/Timeout');
const OperationCancelledError = require('../shared/errors/OperationCancelledError');
const { immutableClone } = require('../shared/utils/object');

class TaskSupervisor {
    constructor({ name = 'TaskSupervisor', logger = null, historyLimit = 32, delay = Timeout.delay } = {}) {
        if (!Number.isInteger(historyLimit) || historyLimit < 0) throw new TypeError('TaskSupervisor historyLimit must be a non-negative integer.');
        if (typeof delay !== 'function') throw new TypeError('TaskSupervisor delay must be a function.');
        this.name = String(name || 'TaskSupervisor');
        this.logger = logger;
        this.historyLimit = historyLimit;
        this.delay = delay;
        this.active = new Map();
        this.history = [];
        this.sequence = 0;
        this.closed = false;
    }

    start(key, runner, {
        restart = 'never',
        maxRestarts = 0,
        baseDelayMs = 250,
        maxDelayMs = 5000,
        cancellationToken = null,
        metadata = null
    } = {}) {
        if (this.closed) throw new Error(`${this.name} is closed.`);
        const taskKey = this.#key(key);
        if (typeof runner !== 'function') throw new TypeError('TaskSupervisor runner must be a function.');
        if (this.active.has(taskKey)) return this.active.get(taskKey).handle;
        if (!['never', 'on-failure'].includes(restart)) throw new TypeError(`Unsupported task restart policy: ${restart}`);
        if (!Number.isInteger(maxRestarts) || maxRestarts < 0) throw new TypeError('maxRestarts must be a non-negative integer.');
        if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0 || !Number.isFinite(maxDelayMs) || maxDelayMs < baseDelayMs) {
            throw new TypeError('Invalid task restart delays.');
        }

        const source = new CancellationSource();
        let unlinkParent = () => {};
        if (cancellationToken?.onCancelled) unlinkParent = cancellationToken.onCancelled(reason => source.cancel(reason));
        if (cancellationToken?.isCancelled) source.cancel(cancellationToken.reason);
        const task = {
            taskId: `${this.name}:${++this.sequence}`,
            key: taskKey,
            state: 'RUNNING',
            attempt: 0,
            restarts: 0,
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            metadata,
            source,
            unlinkParent,
            promise: null,
            handle: null,
            lastError: null
        };
        const handle = Object.freeze({
            taskId: task.taskId,
            key: task.key,
            get promise() { return task.promise; },
            cancel: reason => source.cancel(reason || `Task cancelled: ${task.key}`),
            status: () => this.#snapshotTask(task)
        });
        task.handle = handle;
        task.promise = this.#run(task, runner, { restart, maxRestarts, baseDelayMs, maxDelayMs })
            .finally(() => this.#settle(task));
        this.active.set(taskKey, task);
        return handle;
    }

    get(key) {
        return this.active.get(String(key || '').trim())?.handle || null;
    }

    async stop(key, reason = 'Task stopped.') {
        const task = this.active.get(String(key || '').trim());
        if (!task) return null;
        task.source.cancel(reason);
        try {
            await task.promise;
        } catch (error) {
            if (task.state !== 'CANCELLED') {
                this.logger?.debug?.('Supervised task drain observed a non-cancellation rejection.', {
                    supervisor: this.name, key: task.key, state: task.state, error
                });
            }
        }
        return this.#snapshotTask(task);
    }

    async stopAll(reason = 'Task supervisor stopping.') {
        const tasks = [...this.active.values()];
        for (const task of tasks) task.source.cancel(reason);
        await Promise.allSettled(tasks.map(task => task.promise));
        return tasks.map(task => this.#snapshotTask(task));
    }

    async close(reason = 'Task supervisor closed.') {
        if (this.closed) return [];
        this.closed = true;
        return this.stopAll(reason);
    }

    snapshot() {
        return immutableClone({
            name: this.name,
            closed: this.closed,
            active: [...this.active.values()].map(task => this.#snapshotTask(task)),
            history: [...this.history]
        });
    }

    async #run(task, runner, policy) {
        while (true) {
            task.source.token.throwIfCancelled();
            task.attempt += 1;
            task.state = 'RUNNING';
            task.updatedAt = new Date().toISOString();
            try {
                const value = await runner(Object.freeze({
                    taskId: task.taskId,
                    key: task.key,
                    attempt: task.attempt,
                    cancellationToken: task.source.token,
                    metadata: task.metadata
                }));
                task.state = 'SUCCEEDED';
                task.updatedAt = new Date().toISOString();
                return value;
            } catch (error) {
                if (task.source.token.isCancelled || error?.code === 'CANCELLED' || error instanceof OperationCancelledError) {
                    task.state = 'CANCELLED';
                    task.lastError = { message: String(task.source.token.reason || error.message || 'Cancelled'), code: 'CANCELLED' };
                    task.updatedAt = new Date().toISOString();
                    throw error instanceof OperationCancelledError ? error : new OperationCancelledError(task.lastError.message);
                }
                task.lastError = { message: String(error?.message || error), code: error?.code || null };
                if (policy.restart !== 'on-failure' || task.restarts >= policy.maxRestarts) {
                    task.state = 'FAILED';
                    task.updatedAt = new Date().toISOString();
                    throw error;
                }
                task.restarts += 1;
                task.state = 'BACKOFF';
                task.updatedAt = new Date().toISOString();
                const waitMs = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** Math.max(0, task.restarts - 1)));
                this.logger?.warn?.('Supervised task failed; scheduling bounded restart.', {
                    supervisor: this.name, key: task.key, attempt: task.attempt, restart: task.restarts, waitMs, error
                });
                await this.delay(waitMs, { cancellationToken: task.source.token });
            }
        }
    }

    #settle(task) {
        if (this.active.get(task.key) === task) this.active.delete(task.key);
        task.unlinkParent();
        task.source.dispose();
        const snapshot = this.#snapshotTask(task);
        if (this.historyLimit > 0) {
            this.history.push(snapshot);
            if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit);
        }
    }

    #snapshotTask(task) {
        return {
            taskId: task.taskId,
            key: task.key,
            state: task.state,
            attempt: task.attempt,
            restarts: task.restarts,
            startedAt: task.startedAt,
            updatedAt: task.updatedAt,
            lastError: task.lastError,
            cancellationListenerFailures: task.source.token.listenerErrors.length,
            metadata: task.metadata
        };
    }

    #key(value) {
        const key = String(value || '').trim();
        if (!key || !/^[a-z0-9][a-z0-9:._-]*$/i.test(key)) throw new TypeError(`Invalid task key: ${key || '<empty>'}`);
        return key;
    }
}

module.exports = TaskSupervisor;
