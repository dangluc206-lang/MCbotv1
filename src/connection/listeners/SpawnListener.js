'use strict';

class SpawnListener {
    constructor({ client, eventBus, botId, generation }) {
        Object.assign(this, { client, eventBus, botId, generation });
        this.started = false;
        this.handler = () => eventBus.emit('connection:spawned', {
            botId,
            connectionGeneration: generation
        });
    }

    start() {
        if (this.started) return;
        this.started = true;
        this.client.on('spawn', this.handler);
    }

    stop() {
        if (!this.started) return;
        this.started = false;
        this.client.off('spawn', this.handler);
    }
}

module.exports = SpawnListener;
