'use strict';

class B5BatchCoordinator {
    constructor({ botId } = {}) {
        if (!botId) throw new TypeError('B5BatchCoordinator botId is required.');
        this.botId = String(botId);
        this.sequence = 0;
    }

    next(trigger = 'unspecified') {
        this.sequence += 1;
        return Object.freeze({
            batchId: `${this.botId}:b5-batch:${this.sequence}`,
            sequence: this.sequence,
            trigger: String(trigger)
        });
    }
}

module.exports = B5BatchCoordinator;
