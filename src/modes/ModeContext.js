'use strict';

const { immutableClone } = require('../shared/utils/object');
const TaskSupervisor = require('../core/TaskSupervisor');

class ModeContext {
    constructor({ botId, botContext, capabilityRegistry, eventBus, operationManager, logger = null } = {}) {
        if (typeof botId !== 'string' || !botId.trim()) throw new TypeError('ModeContext botId is required.');
        if (!botContext?.getGeneration || !botContext?.has) throw new TypeError('ModeContext botContext is required.');
        if (!capabilityRegistry?.require || !capabilityRegistry?.assertAvailable) throw new TypeError('ModeContext capabilityRegistry is required.');
        if (!eventBus?.on || !eventBus?.emit) throw new TypeError('ModeContext eventBus is required.');
        if (!operationManager?.run) throw new TypeError('ModeContext operationManager is required.');
        this.botId = botId.trim();
        this.botContext = botContext;
        this.capabilities = capabilityRegistry;
        this.eventBus = eventBus;
        this.operationManager = operationManager;
        this.logger = logger;
    }

    capability(id) {
        return this.capabilities.require(id);
    }

    requireCapabilities(ids, label = 'mode') {
        this.capabilities.assertAvailable(ids, label);
        return Object.freeze(Object.fromEntries((Array.isArray(ids) ? ids : [ids]).map(id => [id, this.capabilities.require(id)])));
    }

    requireReadyCapabilities(ids, label = 'mode') {
        this.capabilities.assertAvailable(ids, label);
        return Object.freeze(Object.fromEntries((Array.isArray(ids) ? ids : [ids]).map(id => [id, this.capabilities.require(id, { ready: true })])));
    }

    generation() {
        return this.botContext.getGeneration();
    }

    connected() {
        return this.botContext.has();
    }

    state() {
        return immutableClone({
            botId: this.botId,
            connected: this.connected(),
            connectionGeneration: this.generation()
        });
    }


    declareEvent(event, { scope = 'bot', allowBotOverride = false } = {}) {
        this.eventBus.registerEventScope(event, scope, { allowBotOverride });
        return this;
    }

    on(event, listener) {
        return this.eventBus.on(event, listener);
    }

    once(event, listener) {
        return this.eventBus.once(event, listener);
    }


    taskSupervisor(name = 'tasks', options = {}) {
        return new TaskSupervisor({ name: `${this.botId}:${name}`, logger: this.logger, ...options });
    }

    subscriptions(name = 'mode') {
        return this.eventBus.subscriptions({ name: `${this.botId}:${name}`, logger: this.logger });
    }

    emit(event, payload = {}, options = {}) {
        const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
        return this.eventBus.emit(event, {
            botId: this.botId,
            connectionGeneration: this.generation(),
            ...body
        }, options);
    }

    run(operation, options = {}) {
        return this.operationManager.run(operation, {
            connectionGeneration: options.connectionGeneration ?? this.generation(),
            ...options
        });
    }
}

module.exports = ModeContext;
