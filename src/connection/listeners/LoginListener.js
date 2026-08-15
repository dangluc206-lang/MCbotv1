'use strict';

class LoginListener {
    constructor({ client, eventBus, botId, generation }) {
        Object.assign(this, { client, eventBus, botId, generation });
        this.started = false;
        this.handler = () => eventBus.emit('connection:login', {
            botId,
            connectionGeneration: generation
        });
    }

    start() {
        if (this.started) return;
        this.started = true;
        this.client.on('login', this.handler);
    }

    stop() {
        if (!this.started) return;
        this.started = false;
        this.client.off('login', this.handler);
    }
}

module.exports = LoginListener;
