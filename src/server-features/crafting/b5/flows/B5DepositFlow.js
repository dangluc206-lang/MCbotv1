'use strict';

class B5DepositFlow {
    constructor({ personalVault }) {
        if (!personalVault?.deposit) throw new TypeError('B5DepositFlow personalVault.deposit is required.');
        this.personalVault = personalVault;
    }

    deposit(logicalId, options = {}) {
        return this.personalVault.deposit(logicalId, options);
    }
}

module.exports = B5DepositFlow;
