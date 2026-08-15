'use strict';

class ConnectionStateView {
    constructor({ context }) {
        if (!context) throw new TypeError('ConnectionStateView context is required');
        this.context = context;
    }

    isConnected() {
        return Boolean(this.context.has());
    }

    generation() {
        return Number(this.context.getGeneration());
    }

    snapshot() {
        return Object.freeze({
            connected: this.isConnected(),
            connectionGeneration: this.generation()
        });
    }

    isCurrentGeneration(expectedGeneration) {
        return this.isConnected() && Number(expectedGeneration) === this.generation();
    }
}

module.exports = ConnectionStateView;