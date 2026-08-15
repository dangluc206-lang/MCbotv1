'use strict';

class ErrorListener {
    constructor({ client, eventBus, botId, generation }) {
        Object.assign(this, { client, eventBus, botId, generation });
        this.started = false;
        this.handler = error => eventBus.emit('connection:error', {
            botId,
            connectionGeneration: generation,
            error
        });
    }

    start() {
        if (this.started) return;
        this.started = true;
        this.client.on('error', this.handler);
    }

    stop() {
        if (!this.started) return;
        this.started = false;
        this.client.off('error', this.handler);
    }
}

module.exports = ErrorListener;
