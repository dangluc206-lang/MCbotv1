'use strict';

const Result = require('../../../../shared/result/Result');

class B2InputAcquisitionFlow {
    constructor({ storage, source = 'storage' } = {}) {
        if (!storage) throw new TypeError('B2InputAcquisitionFlow storage is required.');
        this.storage = storage;
        this.source = source === 'inventory' ? 'inventory' : 'storage';
    }

    reconfigure({ source = 'storage' } = {}) {
        this.source = source === 'inventory' ? 'inventory' : 'storage';
    }

    acquire(baseId, requiredAmount, options = {}) {
        if (this.source === 'storage') {
            return Promise.resolve(Result.ok({
                source: 'storage',
                resource: baseId,
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

module.exports = B2InputAcquisitionFlow;
