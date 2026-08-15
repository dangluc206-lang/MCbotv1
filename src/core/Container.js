'use strict';
class Container {
    constructor(parent = null) { this.parent = parent; this.values = new Map(); }
    register(key, value, { replace = false } = {}) { if (!replace && this.values.has(key)) throw new Error(`Dependency already registered: ${key}`); this.values.set(key, value); return value; }
    has(key) { return this.values.has(key) || Boolean(this.parent?.has(key)); }
    get(key) { return this.values.has(key) ? this.values.get(key) : this.parent?.get(key); }
    require(key) { const value = this.get(key); if (value === undefined) throw new Error(`Dependency not found: ${key}`); return value; }
    createScope() { return new Container(this); }
    keys() { return [...new Set([...(this.parent?.keys() || []), ...this.values.keys()])]; }
    clear() { this.values.clear(); }
}
module.exports = Container;
