'use strict';

class B5StorageFlow {
    constructor({ b1Materials }) {
        if (!b1Materials) throw new TypeError('B5StorageFlow b1Materials is required.');
        this.b1Materials = b1Materials;
    }

    compact(baseId, options = {}) {
        return this.b1Materials.compact(baseId, options);
    }

    compactAll(options = {}) {
        return this.b1Materials.compactAll(options);
    }

    prepareBase(baseId, required, options = {}) {
        // Storage Protection is owned by the mode at the B5 batch boundary.
        // During crafting we only switch the selected B1 family between block
        // and loose form. Pure B5 expands freely; Collector+B5 may pass its
        // own headroom limit through options.
        return this.b1Materials.ensureBaseAvailable(baseId, required, options);
    }
}

module.exports = B5StorageFlow;
