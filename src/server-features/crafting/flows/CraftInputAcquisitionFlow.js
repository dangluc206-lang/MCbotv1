'use strict';

const Result = require('../../../shared/result/Result');
const CraftInputSourcePolicy = require('../support/CraftInputSourcePolicy');

class CraftInputAcquisitionFlow {
    constructor({ storage, source = 'storage', inputSourcePolicy = null } = {}) {
        if (!storage) throw new TypeError('CraftInputAcquisitionFlow storage is required.');
        this.storage = storage;
        // G16: explicit policy object wins; bare `source` string stays as compat.
        this.inputSourcePolicy = inputSourcePolicy || CraftInputSourcePolicy.fromConfig({ inputSource: source });
        this.source = this.inputSourcePolicy.default;
    }

    reconfigure({ source = 'storage', inputSourcePolicy = null } = {}) {
        if (inputSourcePolicy) {
            this.inputSourcePolicy = inputSourcePolicy;
        } else {
            this.inputSourcePolicy = CraftInputSourcePolicy.fromConfig({ inputSource: source });
        }
        this.source = this.inputSourcePolicy.default;
    }

    sourceFor(materialId) {
        return this.inputSourcePolicy.resolve(materialId);
    }

    acquire(baseId, requiredAmount, options = {}) {
        // Per-material policy: inventory source withdraws prepared stock into
        // the bot inventory; storage source needs no withdrawal (materials are
        // prepared in /kho by the storage flow) but reports availability.
        if (this.sourceFor(baseId) === 'storage') {
            return Promise.resolve(Result.ok({
                source: 'storage', resource: baseId,
                requestedAmount: Math.max(0, Number(requiredAmount || 0)),
                withdrawalRequired: false
            }));
        }
        return this.storage.withdrawB1(baseId, {
            ...options,
            requiredAmount: Math.max(0, Number(requiredAmount || 0))
        });
    }
}

module.exports = CraftInputAcquisitionFlow;
