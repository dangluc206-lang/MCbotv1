'use strict';

class CraftKhoReadFlow {
    constructor({ storage }) {
        if (!storage?.read) throw new TypeError('CraftKhoReadFlow storage.read is required.');
        this.storage = storage;
    }

    read(options = {}) {
        return this.storage.read(options);
    }
}

module.exports = CraftKhoReadFlow;
