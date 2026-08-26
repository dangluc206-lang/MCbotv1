'use strict';

const LifecycleCoordinator = require('./LifecycleCoordinator');

class Application {
    constructor({
        botRegistry,
        loggerFactory,
        lifecycleCoordinator = null,
        controlPlane = null,
        logger = null,
        backendReadyLogger = null
    }) {
        this.botRegistry = botRegistry;
        this.loggerFactory = loggerFactory;
        this.lifecycle = lifecycleCoordinator || new LifecycleCoordinator([], {
            name: 'ApplicationLifecycle',
            logger
        });
        this.controlPlane = controlPlane;
        this.logger = logger || loggerFactory?.create?.('Application');
        this.backendReadyLogger = backendReadyLogger;
        this.preRuntimeServices = [];
    }

    registerRuntime(runtime) {
        return this.botRegistry.register(runtime);
    }

    getRuntime(botId) {
        return this.botRegistry.require(botId);
    }

    listRuntimes() {
        return this.botRegistry.list();
    }

    getState() {
        return this.lifecycle.getState();
    }

    addPreRuntimeService(service) {
        if (!service) return this;
        this.preRuntimeServices.push(service);
        return this;
    }

    async initialize() {
        await this.lifecycle.initialize();
        await this.#callPreRuntimeServices('initialize');
        const runtimes = this.botRegistry.list();
        const results = await Promise.allSettled(runtimes.map(runtime => runtime.initialize()));
        this.#logFailures('initialize', runtimes, results);
        return results;
    }

    async start() {
        await this.lifecycle.start();
        const runtimes = this.botRegistry.list();
        this.backendReadyLogger?.info?.('MCbot Desktop backend started.', { runtimes: runtimes.length });
        await this.#callPreRuntimeServices('start');
        const results = await Promise.allSettled(runtimes.map(runtime => runtime.start()));
        this.#logFailures('start', runtimes, results);
        if (this.controlPlane) {
            const reconciliation = await this.controlPlane.reconcileAll({ reason: 'application-start' });
            const failed = reconciliation.filter(entry => entry.result?.success === false);
            if (failed.length > 0) {
                this.logger?.warn?.('Some durable fleet intents were not applied after runtime start.', {
                    failed: failed.map(entry => ({
                        botId: entry.botId,
                        status: entry.result.status,
                        message: entry.result.message
                    }))
                });
            }
        }
        return results;
    }

    async stop() {
        const runtimes = this.botRegistry.list();
        const results = await Promise.allSettled(runtimes.map(runtime => runtime.stop()));
        this.#logFailures('stop', runtimes, results);
        await this.#callPreRuntimeServices('stop', { reverse: true });
        await this.lifecycle.stop();
        return results;
    }

    async destroy() {
        const runtimes = this.botRegistry.list();
        const results = await Promise.allSettled(runtimes.map(runtime => runtime.destroy()));
        this.#logFailures('destroy', runtimes, results);
        await this.#callPreRuntimeServices('destroy', { reverse: true });
        await this.lifecycle.destroy();
        return results;
    }

    async #callPreRuntimeServices(method, { reverse = false } = {}) {
        const services = reverse ? [...this.preRuntimeServices].reverse() : this.preRuntimeServices;
        for (const service of services) {
            if (typeof service?.[method] === 'function') await service[method]();
        }
    }

    #logFailures(step, runtimes, results) {
        results.forEach((result, index) => {
            if (result.status !== 'rejected') return;
            this.logger?.error?.(`Runtime ${step} failed.`, {
                botId: runtimes[index]?.botId,
                error: result.reason
            });
        });
    }
}

module.exports = Application;
