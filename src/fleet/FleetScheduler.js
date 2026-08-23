'use strict';

const { randomUUID } = require('node:crypto');
const CancellationSource = require('../shared/cancellation/CancellationSource');
const OperationCancelledError = require('../shared/errors/OperationCancelledError');
const TimeoutError = require('../shared/errors/TimeoutError');
const Timeout = require('../shared/time/Timeout');
const { immutableClone } = require('../shared/utils/object');

const PRIORITY = Object.freeze({ low: 0, normal: 1, high: 2, critical: 3 });

class FleetScheduler {
    constructor({
        concurrency = 2,
        maxPending = 256,
        taskTimeoutMs = 60000,
        shutdownDrainMs = 5000,
        idFactory = randomUUID,
        logger = null
    } = {}) {
        if (!Number.isInteger(concurrency) || concurrency < 1) throw new TypeError('FleetScheduler concurrency must be a positive integer');
        if (!Number.isInteger(maxPending) || maxPending < 1) throw new TypeError('FleetScheduler maxPending must be a positive integer');
        if (!Number.isFinite(taskTimeoutMs) || taskTimeoutMs < 0) throw new TypeError('FleetScheduler taskTimeoutMs must be non-negative');
        if (!Number.isFinite(shutdownDrainMs) || shutdownDrainMs < 0) throw new TypeError('FleetScheduler shutdownDrainMs must be non-negative');
        this.name = 'FleetScheduler';
        this.concurrency = concurrency;
        this.maxPending = maxPending;
        this.taskTimeoutMs = taskTimeoutMs;
        this.shutdownDrainMs = shutdownDrainMs;
        this.idFactory = idFactory;
        this.logger = logger;
        this.state = 'CREATED';
        this.sequence = 0;
        this.pending = [];
        this.running = new Map();
        this.runningBots = new Set();
        this.deduped = new Map();
        this.lastBotId = null;
        this.pumpQueued = false;
        this.stopPromise = null;
    }

    async initialize() {
        if (this.state === 'DESTROYED') throw new Error('FleetScheduler is destroyed.');
        if (['INITIALIZED', 'RUNNING'].includes(this.state)) return;
        if (!['CREATED', 'STOPPED'].includes(this.state)) throw new Error(`FleetScheduler cannot initialize from ${this.state}.`);
        this.state = 'INITIALIZED';
    }

    async start() {
        if (this.state === 'DESTROYED') throw new Error('FleetScheduler is destroyed.');
        if (this.state === 'RUNNING') return;
        if (['CREATED', 'STOPPED'].includes(this.state)) await this.initialize();
        if (this.state !== 'INITIALIZED') throw new Error(`FleetScheduler cannot start from ${this.state}.`);
        this.state = 'RUNNING';
        this.#queuePump();
    }

    schedule({ botId, key, priority = 'normal', cancellationToken = null, run }) {
        if (this.state !== 'RUNNING') return Promise.reject(this.#error('FLEET_SCHEDULER_NOT_RUNNING', 'Fleet scheduler is not running.'));
        if (typeof botId !== 'string' || !botId.trim()) return Promise.reject(new TypeError('botId is required'));
        if (typeof key !== 'string' || !key.trim()) return Promise.reject(new TypeError('task key is required'));
        if (!Object.prototype.hasOwnProperty.call(PRIORITY, priority)) return Promise.reject(new TypeError(`Unsupported fleet priority: ${priority}`));
        if (typeof run !== 'function') return Promise.reject(new TypeError('task run function is required'));
        const normalizedBotId = botId.trim();
        const normalizedKey = key.trim();
        const dedupeKey = JSON.stringify([normalizedBotId, normalizedKey]);
        const existing = this.deduped.get(dedupeKey);
        if (existing) return existing.promise;
        if (this.pending.length >= this.maxPending) {
            return Promise.reject(this.#error('FLEET_QUEUE_FULL', `Fleet queue is full (${this.maxPending}).`));
        }

        const cancellation = new CancellationSource();
        let unlinkParent = () => {};
        if (cancellationToken?.onCancelled) unlinkParent = cancellationToken.onCancelled(reason => cancellation.cancel(reason));
        if (cancellationToken?.isCancelled) cancellation.cancel(cancellationToken.reason);
        let resolveTask;
        let rejectTask;
        const promise = new Promise((resolve, reject) => {
            resolveTask = resolve;
            rejectTask = reject;
        });
        const taskId = String(this.idFactory() || '').trim();
        if (!taskId) {
            unlinkParent();
            cancellation.dispose();
            return Promise.reject(new Error('FleetScheduler idFactory returned an empty taskId.'));
        }
        if (this.running.has(taskId) || this.pending.some(task => task.taskId === taskId)) {
            unlinkParent();
            cancellation.dispose();
            return Promise.reject(this.#error('FLEET_TASK_ID_COLLISION', `Fleet taskId is already active: ${taskId}`));
        }
        const task = {
            taskId,
            botId: normalizedBotId,
            key: normalizedKey,
            dedupeKey,
            priority,
            priorityValue: PRIORITY[priority],
            sequence: ++this.sequence,
            run,
            cancellation,
            unlink: () => {},
            promise,
            resolve: resolveTask,
            reject: rejectTask,
            state: 'PENDING'
        };
        const unlinkCancellation = cancellation.token.onCancelled(reason => {
            if (task.state === 'PENDING') this.#cancelPending(task, reason);
        });
        task.unlink = () => {
            unlinkParent();
            unlinkCancellation();
        };
        this.pending.push(task);
        this.deduped.set(dedupeKey, task);
        if (cancellation.token.isCancelled) this.#cancelPending(task, cancellation.token.reason);
        else this.#queuePump();
        return promise;
    }

    status() {
        return immutableClone({
            state: this.state,
            concurrency: this.concurrency,
            maxPending: this.maxPending,
            pending: this.pending.map(task => this.#taskSnapshot(task)),
            running: [...this.running.values()].map(task => this.#taskSnapshot(task)),
            runningBots: [...this.runningBots].sort()
        });
    }

    async stop(reason = 'Fleet scheduler stopping.') {
        if (['STOPPED', 'DESTROYED'].includes(this.state)) return;
        if (this.stopPromise) return this.stopPromise;
        this.stopPromise = this.#stop(reason);
        try {
            await this.stopPromise;
        } finally {
            this.stopPromise = null;
        }
    }

    async #stop(reason) {
        this.state = 'STOPPING';
        for (const task of [...this.pending]) this.#cancelPending(task, reason);
        for (const task of this.running.values()) task.cancellation.cancel(reason);
        const running = [...this.running.values()].map(task => task.promise.catch(() => undefined));
        if (running.length > 0) {
            try {
                await Timeout.withTimeout(Promise.all(running), this.shutdownDrainMs, {
                    message: 'Fleet scheduler drain timed out.'
                });
            } catch (error) {
                this.logger?.warn?.('Fleet scheduler stopped before every running task drained.', {
                    running: this.running.size,
                    error
                });
            }
        }
        this.state = 'STOPPED';
    }

    async destroy() {
        if (this.state === 'DESTROYED') return;
        await this.stop('Fleet scheduler destroyed.');
        this.state = 'DESTROYED';
    }

    #queuePump() {
        if (this.pumpQueued || this.state !== 'RUNNING') return;
        this.pumpQueued = true;
        queueMicrotask(() => {
            this.pumpQueued = false;
            this.#pump();
        });
    }

    #pump() {
        while (this.state === 'RUNNING' && this.running.size < this.concurrency) {
            const task = this.#takeNext();
            if (!task) return;
            this.#startTask(task);
        }
    }

    #takeNext() {
        const eligible = this.pending.filter(task => !this.runningBots.has(task.botId));
        if (eligible.length === 0) return null;
        const highest = Math.max(...eligible.map(task => task.priorityValue));
        const candidates = eligible.filter(task => task.priorityValue === highest).sort((left, right) => left.sequence - right.sequence);
        const selected = candidates.find(task => task.botId !== this.lastBotId) || candidates[0];
        this.pending.splice(this.pending.indexOf(selected), 1);
        this.lastBotId = selected.botId;
        return selected;
    }

    #startTask(task) {
        task.state = 'RUNNING';
        this.running.set(task.taskId, task);
        this.runningBots.add(task.botId);
        const execution = Promise.resolve().then(() => {
            task.cancellation.token.throwIfCancelled();
            return task.run(Object.freeze({
                taskId: task.taskId,
                botId: task.botId,
                key: task.key,
                priority: task.priority,
                cancellationToken: task.cancellation.token
            }));
        });
        const bounded = this.taskTimeoutMs > 0
            ? Timeout.withTimeout(execution, this.taskTimeoutMs, {
                cancellationToken: task.cancellation.token,
                message: `Fleet task timed out: ${task.dedupeKey}`
            })
            : execution;
        bounded.then(
            value => this.#settle(task, null, value),
            error => {
                if (error instanceof TimeoutError || error?.code === 'TIMEOUT') {
                    task.cancellation.cancel(`Fleet task timed out: ${task.dedupeKey}`);
                }
                this.#settle(task, error);
            }
        );
    }

    #cancelPending(task, reason) {
        const index = this.pending.indexOf(task);
        if (index >= 0) this.pending.splice(index, 1);
        task.cancellation.cancel(reason);
        this.#settle(task, new OperationCancelledError(String(reason || 'Fleet task cancelled.')));
    }

    #settle(task, error, value = null) {
        if (task.state === 'SETTLED') return;
        const wasRunning = task.state === 'RUNNING';
        task.state = 'SETTLED';
        if (wasRunning) {
            this.running.delete(task.taskId);
            this.runningBots.delete(task.botId);
        }
        if (this.deduped.get(task.dedupeKey) === task) this.deduped.delete(task.dedupeKey);
        task.unlink();
        task.cancellation.dispose();
        if (error) task.reject(error);
        else task.resolve(value);
        this.#queuePump();
    }

    #taskSnapshot(task) {
        return {
            taskId: task.taskId,
            botId: task.botId,
            key: task.key,
            priority: task.priority,
            sequence: task.sequence,
            state: task.state
        };
    }

    #error(code, message) {
        const error = new Error(message);
        error.code = code;
        return error;
    }
}

module.exports = FleetScheduler;
