'use strict';

class PersonalVaultStorageFlow {
    constructor({ personalVault, config = {} } = {}) {
        if (!personalVault?.deposit) {
            throw new TypeError('PersonalVaultStorageFlow personalVault.deposit is required.');
        }

        this.personalVault = personalVault;
        this.config = Object.freeze({
            verify: config.verify !== false
        });
    }

    reconfigure(config = {}) {
        this.config = Object.freeze({
            ...this.config,
            ...(config || {})
        });
        return this;
    }

    deposit(logicalId, options = {}) {
        return this.personalVault.deposit(logicalId, {
            ...options,
            verify: options.verify ?? this.config.verify
        });
    }
}

module.exports = PersonalVaultStorageFlow;