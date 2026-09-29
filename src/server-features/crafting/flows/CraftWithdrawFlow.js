'use strict';

class CraftWithdrawFlow {
    constructor({ personalVault }) {
        if (!personalVault?.withdraw) throw new TypeError('CraftWithdrawFlow personalVault.withdraw is required.');
        this.personalVault = personalVault;
    }

    withdraw(logicalId, options = {}) {
        return this.personalVault.withdraw(logicalId, options);
    }
}

module.exports = CraftWithdrawFlow;
