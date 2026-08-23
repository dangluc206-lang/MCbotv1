'use strict';

class B5WithdrawFlow {
    constructor({ personalVault }) {
        if (!personalVault?.withdraw) throw new TypeError('B5WithdrawFlow personalVault.withdraw is required.');
        this.personalVault = personalVault;
    }

    withdraw(logicalId, options = {}) {
        return this.personalVault.withdraw(logicalId, options);
    }
}

module.exports = B5WithdrawFlow;
