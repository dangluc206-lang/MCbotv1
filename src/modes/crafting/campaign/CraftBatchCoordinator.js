'use strict';

class CraftBatchCoordinator {
    constructor({ botId } = {}) {
        if (!botId) throw new TypeError('CraftBatchCoordinator botId is required.');
        this.botId = String(botId);
        this.sequence = 0;
    }

    next(trigger = 'unspecified') {
        this.sequence += 1;
        return Object.freeze({
            batchId: `${this.botId}:craft-batch:${this.sequence}`,
            sequence: this.sequence,
            trigger: String(trigger)
        });
    }
}

module.exports = CraftBatchCoordinator;
