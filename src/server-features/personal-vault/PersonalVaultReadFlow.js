'use strict';

class PersonalVaultReadFlow {
    constructor({ personalVault, config = {} } = {}) {
        if (!personalVault?.read) {
            throw new TypeError('PersonalVaultReadFlow personalVault.read is required.');
        }

        this.personalVault = personalVault;
        this.config = Object.freeze({
            preferData: config.preferData === true,
            maxAgeMs: Number.isFinite(Number(config.maxAgeMs))
                ? Math.max(0, Number(config.maxAgeMs))
                : Infinity
        });
    }

    reconfigure(config = {}) {
        const next = config || {};

        this.config = Object.freeze({
            ...this.config,
            ...(Object.prototype.hasOwnProperty.call(next, 'preferData')
                ? { preferData: next.preferData === true }
                : {}),
            ...(Object.prototype.hasOwnProperty.call(next, 'maxAgeMs')
                ? {
                    maxAgeMs: Number.isFinite(Number(next.maxAgeMs))
                        ? Math.max(0, Number(next.maxAgeMs))
                        : Infinity
                }
                : {})
        });

        return this;
    }

    read(options = {}) {
        return this.personalVault.read({
            ...options,
            preferData: options.preferData ?? this.config.preferData,
            maxAgeMs: options.maxAgeMs ?? this.config.maxAgeMs
        });
    }
}

module.exports = PersonalVaultReadFlow;