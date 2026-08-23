'use strict';
const { immutableClone, deepClone } = require('../shared/utils/object');

class StateStore {
    constructor(initial = {}) {
        this.state = deepClone(initial);
        this.listeners = new Set();
        this.revision = 0;
    }

    get() { return immutableClone(this.state); }

    patch(patch) {
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('patch must be an object');
        const previous = this.get();
        this.state = { ...this.state, ...deepClone(patch) };
        this.#changed(previous, 'patch');
        return this.get();
    }

    update(mutator) {
        if (typeof mutator !== 'function') throw new TypeError('StateStore mutator must be a function.');
        const previous = this.get();
        const draft = deepClone(this.state);
        const returned = mutator(draft);
        const next = returned === undefined ? draft : returned;
        if (!next || typeof next !== 'object' || Array.isArray(next)) throw new TypeError('StateStore mutator must produce an object state.');
        this.state = deepClone(next);
        this.#changed(previous, 'update');
        return this.get();
    }

    reset(next = {}) {
        if (!next || typeof next !== 'object' || Array.isArray(next)) throw new TypeError('StateStore reset state must be an object.');
        const previous = this.get();
        this.state = deepClone(next);
        this.#changed(previous, 'reset');
        return this.get();
    }

    onChange(listener, { immediate = false } = {}) {
        if (typeof listener !== 'function') throw new TypeError('StateStore change listener must be a function.');
        this.listeners.add(listener);
        if (immediate) listener(Object.freeze({ type: 'snapshot', revision: this.revision, previous: null, current: this.get() }));
        return () => this.listeners.delete(listener);
    }

    getRevision() { return this.revision; }

    #changed(previous, type) {
        this.revision += 1;
        const change = Object.freeze({ type, revision: this.revision, previous, current: this.get() });
        for (const listener of [...this.listeners]) listener(change);
    }
}
module.exports = StateStore;
