'use strict';

class B5Pv2ReadFlow {
    constructor({ personalVault }) {
        if (!personalVault?.read) throw new TypeError('B5Pv2ReadFlow personalVault.read is required.');
        this.personalVault = personalVault;
    }

    read(options = {}) {
        return this.personalVault.read(options);
    }
}

module.exports = B5Pv2ReadFlow;
