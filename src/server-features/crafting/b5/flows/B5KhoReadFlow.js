'use strict';

class B5KhoReadFlow {
    constructor({ storage }) {
        if (!storage?.read) throw new TypeError('B5KhoReadFlow storage.read is required.');
        this.storage = storage;
    }

    read(options = {}) {
        return this.storage.read(options);
    }
}

module.exports = B5KhoReadFlow;
