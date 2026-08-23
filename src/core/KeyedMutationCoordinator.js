'use strict';

class KeyedMutationCoordinator {
    constructor({ name = 'KeyedMutationCoordinator', logger = null } = {}) {
        this.name = name;
        this.logger = logger;
        this.tails = new Map();
    }

    run(key, work) {
        const normalizedKey = this.#key(key);
        if (typeof work !== 'function') throw new TypeError('Mutation work must be a function.');
        const previous = this.tails.get(normalizedKey) || Promise.resolve();
        const task = previous.then(() => work());
        const tail = task.catch(error => {
            this.logger?.warn?.('Keyed mutation failed; key queue recovered for the next mutation.', {
                key: normalizedKey,
                error
            });
        }).finally(() => {
            if (this.tails.get(normalizedKey) === tail) this.tails.delete(normalizedKey);
        });
        this.tails.set(normalizedKey, tail);
        return task;
    }

    async drain(key = null) {
        if (key !== null && key !== undefined) {
            const tail = this.tails.get(this.#key(key));
            if (tail) await tail;
            return;
        }
        while (this.tails.size > 0) {
            await Promise.all([...this.tails.values()]);
        }
    }

    activeKeys() {
        return Object.freeze([...this.tails.keys()].sort());
    }

    async initialize() {}
    async start() {}
    async stop() { await this.drain(); }
    async destroy() { await this.drain(); }

    #key(value) {
        const key = String(value || '').trim();
        if (!key) throw new TypeError('Mutation key must be a non-empty string.');
        return key;
    }
}

module.exports = KeyedMutationCoordinator;
