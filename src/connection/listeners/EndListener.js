'use strict';

class EndListener {
    constructor({ client, eventBus, botId, generation, isIntentional = () => false }) {
        Object.assign(this, { client, eventBus, botId, generation, isIntentional });
        this.started = false;
        this.handler = reason => eventBus.emit('connection:ended', {
            botId,
            connectionGeneration: generation,
            reason,
            intentional: Boolean(isIntentional())
        });
    }

    start() {
        if (this.started) return;
        this.started = true;
        this.client.on('end', this.handler);
    }

    stop() {
        if (!this.started) return;
        this.started = false;
        this.client.off('end', this.handler);
    }
}

module.exports = EndListener;
