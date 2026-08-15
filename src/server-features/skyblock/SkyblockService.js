'use strict';

const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');

class SkyblockService {
    constructor({ operation }) {
        if (!operation || typeof operation.execute !== 'function') {
            throw new TypeError('skyblock operation is required');
        }
        this.operation = operation;
    }

    async join(selectionId = null, options = {}) {
        try {
            return Result.ok(await this.operation.execute(selectionId, options));
        } catch (error) {
            const status = error?.code === 'TIMEOUT'
                ? Status.TIMEOUT
                : error?.code === 'CANCELLED'
                    ? Status.CANCELLED
                    : Status.FAILED;
            return Result.fail(status, error.message, error, { selectionId });
        }
    }
}

module.exports = SkyblockService;
