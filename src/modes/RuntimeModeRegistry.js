'use strict';

const KeyedMutationCoordinator = require('../core/KeyedMutationCoordinator');
const Result = require('../shared/result/Result');
const Status = require('../shared/result/Status');
const { immutableClone } = require('../shared/utils/object');

const REQUIRED_METHODS = ['enable', 'disable', 'pause', 'resume', 'status'];

class RuntimeModeRegistry {
    constructor({ botId, catalog, capabilityRegistry, services = {}, mutationCoordinator = null } = {}) {
        if (typeof botId !== 'string' || !botId.trim()) throw new TypeError('RuntimeModeRegistry botId is required.');
        if (!catalog?.list || !catalog?.require) throw new TypeError('RuntimeModeRegistry catalog is required.');
        if (!capabilityRegistry?.missing) throw new TypeError('RuntimeModeRegistry capabilityRegistry is required.');
        this.botId = botId.trim();
        this.catalog = catalog;
        this.capabilityRegistry = capabilityRegistry;
        // I7: serialize same-mode transitions so ModeControlService (operator)
        // and FleetReconciler (durable intent) cannot interleave one mode's
        // enable/pause/resume/disable hooks.
        this.mutations = mutationCoordinator || new KeyedMutationCoordinator({ name: `ModeTransitions:${this.botId}` });
        this.services = new Map();
        for (const [name, service] of Object.entries(services)) this.bindByServiceName(name, service);
    }

    bind(modeId, service) {
        const definition = this.catalog.require(modeId);
        this.#service(definition, service);
        this.services.set(definition.id, service);
        return this;
    }

    bindByServiceName(serviceName, service) {
        const definition = this.catalog.list().find(item => item.serviceName === serviceName);
        if (!definition) return false;
        this.bind(definition.id, service);
        return true;
    }

    has(modeId) {
        return this.services.has(String(modeId || '').trim());
    }

    get(modeId) {
        return this.services.get(String(modeId || '').trim()) || null;
    }

    require(modeId) {
        const definition = this.catalog.require(modeId);
        const service = this.services.get(definition.id);
        if (!service) {
            const error = new Error(`Mode service is not bound for ${definition.id} (${definition.serviceName}).`);
            error.code = 'MODE_SERVICE_NOT_BOUND';
            error.modeId = definition.id;
            error.botId = this.botId;
            throw error;
        }
        return service;
    }

    readiness(modeId) {
        const definition = this.catalog.require(modeId);
        const missingCapabilities = this.capabilityRegistry.missing(definition.requiredCapabilities);
        const serviceBound = this.services.has(definition.id);
        return immutableClone({
            botId: this.botId,
            modeId: definition.id,
            serviceBound,
            missingCapabilities,
            ready: serviceBound && missingCapabilities.length === 0
        });
    }

    assertReady(modeId) {
        const state = this.readiness(modeId);
        if (!state.serviceBound) this.require(modeId);
        if (state.missingCapabilities.length > 0) {
            const error = new Error(`Mode ${modeId} cannot run; missing capabilities: ${state.missingCapabilities.join(', ')}`);
            error.code = 'MODE_CAPABILITIES_UNMET';
            error.modeId = modeId;
            error.botId = this.botId;
            error.missingCapabilities = state.missingCapabilities;
            throw error;
        }
        return true;
    }

    async transition(modeId, action, reason = null) {
        const normalizedAction = String(action || '').trim().toLowerCase();
        if (!['enable', 'disable', 'pause', 'resume'].includes(normalizedAction)) {
            throw new TypeError(`Unsupported mode transition: ${action}`);
        }
        const definition = this.catalog.require(modeId);
        // I7: serialize per mode id. Distinct modes may still transition in
        // parallel (different primary lease claims fail fast at the coordinator).
        return this.mutations.run(definition.id, async () => {
            const service = this.require(definition.id);
            if (normalizedAction === 'enable') this.assertReady(definition.id);
            return service[normalizedAction](...(normalizedAction === 'disable' || normalizedAction === 'pause' ? [reason] : []));
        });
    }

    async disableAll(reason = 'Mode registry reset.', { except = null } = {}) {
        const results = [];
        for (const definition of this.catalog.list()) {
            if (except && definition.id === except) continue;
            // I7: disableAll is part of the same per-mode serialization as
            // transition() so an operator enable and a reconcile disableAll
            // cannot interleave one mode's hooks.
            const service = this.get(definition.id);
            if (!service?.status?.().enabled) continue;
            const result = await this.mutations.run(definition.id, () => service.disable(reason));
            results.push({ modeId: definition.id, result });
        }
        return results;
    }

    active() {
        return this.catalog.list()
            .map(definition => {
                const service = this.get(definition.id);
                const status = service?.status?.() || null;
                return status?.enabled ? { definition, status } : null;
            })
            .filter(Boolean);
    }

    status(modeId = null) {
        if (modeId) {
            const definition = this.catalog.require(modeId);
            const service = this.get(definition.id);
            return immutableClone({ definition, readiness: this.readiness(definition.id), status: service?.status?.() || null });
        }
        return immutableClone({
            botId: this.botId,
            modes: this.catalog.list().map(definition => ({
                definition,
                readiness: this.readiness(definition.id),
                status: this.get(definition.id)?.status?.() || null
            }))
        });
    }

    #service(definition, service) {
        if (!service || typeof service !== 'object') throw new TypeError(`Mode service is required: ${definition.id}`);
        const missing = REQUIRED_METHODS.filter(method => typeof service[method] !== 'function');
        if (missing.length > 0) {
            const error = new TypeError(`Mode service ${definition.id} is missing methods: ${missing.join(', ')}`);
            error.code = 'MODE_CONTRACT_INVALID';
            error.modeId = definition.id;
            error.missingMethods = missing;
            throw error;
        }
    }
}

RuntimeModeRegistry.REQUIRED_METHODS = Object.freeze([...REQUIRED_METHODS]);
module.exports = RuntimeModeRegistry;
