'use strict';

const { immutableClone } = require('../../shared/utils/object');

class KhoSnapshot {
    constructor({ items = {}, capacity = null, sources = {}, capturedAt = Date.now() }) {
        this.items = immutableClone(items);
        this.capacity = immutableClone(capacity);
        this.sources = immutableClone(sources);
        this.capturedAt = capturedAt;
        Object.freeze(this);
    }

    count(logicalId) {
        return Number(this.items[logicalId] || 0);
    }
}

module.exports = KhoSnapshot;
