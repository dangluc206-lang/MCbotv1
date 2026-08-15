'use strict';

const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');

class MineralService {
    constructor({ operation }) {
        this.operation = operation;
    }

    isAvailable(baseId, direction = 'toBlock') {
        return this.operation.isAvailable?.(baseId, direction) !== false;
    }

    async convert(baseId, options = {}) {
        try {
            return Result.ok(await this.operation.execute(baseId, options));
        } catch (error) {
            return Result.fail(Status.FAILED, error.message, error, { baseId, direction: options.direction || 'toBlock' });
        }
    }

    toBlocks(baseId, options = {}) {
        return this.convert(baseId, { ...options, direction: 'toBlock' });
    }

    toBase(baseId, options = {}) {
        return this.convert(baseId, { ...options, direction: 'toBase' });
    }
}

module.exports = MineralService;
