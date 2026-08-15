'use strict';

class KickedListener {
    constructor({ client, eventBus, botId, generation }) {
        Object.assign(this, { client, eventBus, botId, generation });
        this.started = false;
        this.handler = reason => eventBus.emit('connection:kicked', {
            botId,
            connectionGeneration: generation,
            reason
        });
    }

    start() {
        if (this.started) return;
        this.started = true;
        this.client.on('kicked', this.handler);
    }

    stop() {
        if (!this.started) return;
        this.started = false;
        this.client.off('kicked', this.handler);
    }
}

module.exports = KickedListener;
