'use strict';
const { immutableClone, deepClone } = require('../shared/utils/object');
class StateStore {
    constructor(initial = {}) { this.state = deepClone(initial); }
    get() { return immutableClone(this.state); }
    patch(patch) { if (!patch || typeof patch !== 'object') throw new TypeError('patch must be an object'); this.state = { ...this.state, ...deepClone(patch) }; return this.get(); }
    reset(next = {}) { this.state = deepClone(next); return this.get(); }
}
module.exports = StateStore;
