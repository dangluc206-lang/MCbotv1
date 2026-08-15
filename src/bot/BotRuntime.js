'use strict';

class BotRuntime {
    constructor({ identity, context, state, lifecycleCoordinator, logger = null, services = {} }) {
        this.identity = identity;
        this.botId = identity.botId;
        this.context = context;
        this.state = state;
        this.lifecycle = lifecycleCoordinator;
        this.logger = logger;
        this.services = Object.freeze({ ...services });
    }

    async initialize() {
        try {
            await this.lifecycle.initialize();
            this.state.patch({ lifecycleState: 'INITIALIZED', lastError: null });
        } catch (error) {
            this.state.patch({ lifecycleState: 'FAILED', lastError: error });
            throw error;
        }
    }

    async start() {
        try {
            await this.lifecycle.start();
            this.state.patch({
                lifecycleState: 'RUNNING',
                startedAt: new Date().toISOString(),
                stoppedAt: null
            });
        } catch (error) {
            this.state.patch({ lifecycleState: 'FAILED', lastError: error });
            throw error;
        }
    }

    async stop() {
        try {
            await this.lifecycle.stop();
            this.state.patch({
                lifecycleState: 'STOPPED',
                stoppedAt: new Date().toISOString()
            });
        } catch (error) {
            this.state.patch({ lifecycleState: 'FAILED', lastError: error });
            throw error;
        }
    }

    async destroy() {
        try {
            await this.lifecycle.destroy();
            this.state.patch({
                lifecycleState: 'STOPPED',
                stoppedAt: new Date().toISOString()
            });
        } catch (error) {
            this.state.patch({ lifecycleState: 'FAILED', lastError: error });
            throw error;
        }
    }

    getState() {
        return this.state.get();
    }

    getService(name) {
        return this.services[name] || null;
    }

    requireService(name) {
        const value = this.getService(name);
        if (!value) throw new Error(`Bot service not found: ${name}`);
        return value;
    }
}

module.exports = BotRuntime;
