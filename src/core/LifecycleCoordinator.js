'use strict';

const LifecycleState = require('./constants/LifecycleState');
const AppError = require('../shared/errors/AppError');

class LifecycleCoordinator {
    constructor(components = [], { name = 'LifecycleCoordinator', logger = null } = {}) {
        this.name = name;
        this.logger = logger;
        this.components = [...components];
        this.state = LifecycleState.CREATED;
        this.initialized = [];
        this.started = [];
    }

    add(component) {
        if (this.state !== LifecycleState.CREATED) {
            throw new AppError('Cannot add components after lifecycle begins.', {
                code: 'LIFECYCLE_LOCKED'
            });
        }
        this.components.push(component);
        return this;
    }

    getState() {
        return this.state;
    }

    async initialize() {
        if ([LifecycleState.INITIALIZED, LifecycleState.RUNNING].includes(this.state)) return;
        if (![LifecycleState.CREATED, LifecycleState.STOPPED].includes(this.state)) {
            throw this.#error('initialize');
        }

        this.state = LifecycleState.INITIALIZING;
        this.initialized = [];
        let current = null;

        try {
            for (const component of this.components) {
                current = component;
                if (typeof component?.initialize === 'function') await component.initialize();
                this.initialized.push(component);
            }
            this.state = LifecycleState.INITIALIZED;
        } catch (error) {
            await this.#safeCall(current, 'destroy');
            await this.#rollback(this.initialized, 'destroy');
            this.initialized = [];
            this.state = LifecycleState.FAILED;
            throw this.#wrap(error, 'initialize', current);
        }
    }

    async start() {
        if (this.state === LifecycleState.RUNNING) return;
        if (this.state !== LifecycleState.INITIALIZED) throw this.#error('start');

        this.state = LifecycleState.STARTING;
        this.started = [];
        let current = null;

        try {
            for (const component of this.components) {
                current = component;
                if (typeof component?.start === 'function') await component.start();
                this.started.push(component);
            }
            this.state = LifecycleState.RUNNING;
        } catch (error) {
            await this.#safeCall(current, 'stop');
            await this.#rollback(this.started, 'stop');
            this.started = [];
            this.state = LifecycleState.FAILED;
            throw this.#wrap(error, 'start', current);
        }
    }

    async stop() {
        if ([LifecycleState.STOPPED, LifecycleState.CREATED].includes(this.state)) {
            this.state = LifecycleState.STOPPED;
            return;
        }
        if (this.state === LifecycleState.STOPPING) return;

        this.state = LifecycleState.STOPPING;
        await this.#rollback(this.started.length ? this.started : this.components, 'stop');
        this.started = [];
        this.state = LifecycleState.STOPPED;
    }

    async destroy() {
        await this.stop();
        await this.#rollback(this.initialized.length ? this.initialized : this.components, 'destroy');
        this.initialized = [];
        this.state = LifecycleState.STOPPED;
    }

    async #safeCall(component, method) {
        if (!component || typeof component[method] !== 'function') return;
        try {
            await component[method]();
        } catch (error) {
            this.logger?.error?.(`Lifecycle ${method} failed.`, {
                component: this.#name(component),
                error
            });
        }
    }

    async #rollback(list, method) {
        for (const component of [...new Set(list)].reverse()) {
            await this.#safeCall(component, method);
        }
    }

    #name(component) {
        return component?.name || component?.constructor?.name || 'anonymous';
    }

    #error(step) {
        return new AppError(`Invalid lifecycle transition: ${this.state} -> ${step}`, {
            code: 'INVALID_LIFECYCLE_TRANSITION',
            details: { state: this.state, step }
        });
    }

    #wrap(error, step, component) {
        return new AppError(
            `Lifecycle ${step} failed for ${this.#name(component)}: ${error.message}`,
            {
                code: 'LIFECYCLE_FAILURE',
                cause: error,
                details: { step, component: this.#name(component) }
            }
        );
    }
}

module.exports = LifecycleCoordinator;
