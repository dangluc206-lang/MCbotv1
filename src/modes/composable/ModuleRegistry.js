'use strict';

const { immutableClone } = require('../../shared/utils/object');

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const CAPABILITY = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const RESOURCE = /^[a-z][a-z0-9]*(?:[-.:][a-z0-9]+)*$/;

class ModuleRegistry {
    constructor({ descriptors = [], capabilityRegistry = null } = {}) {
        this.descriptors = new Map();
        this.capabilityRegistry = capabilityRegistry;
        for (const descriptor of descriptors) this.register(descriptor);
        this.sealed = false;
    }

    register(descriptor) {
        if (this.sealed) throw this.#error('WORKFLOW_MODULE_REGISTRY_SEALED', 'Module registry is sealed.');
        const value = this.#validate(descriptor);
        if (this.descriptors.has(value.type)) {
            throw this.#error('WORKFLOW_MODULE_DUPLICATE', `Module already registered: ${value.type}`);
        }
        if (this.capabilityRegistry?.has && value.capability && !this.capabilityRegistry.has(value.capability)) {
            throw this.#error('WORKFLOW_MODULE_CAPABILITY_UNKNOWN', `Capability is not registered: ${value.capability}`);
        }
        this.descriptors.set(value.type, Object.freeze(value));
        return this;
    }

    registerAll(descriptors = []) {
        for (const descriptor of descriptors) this.register(descriptor);
        return this;
    }

    seal() {
        this.sealed = true;
        return this;
    }

    has(type) { return this.descriptors.has(String(type || '').trim()); }

    require(type) {
        const id = String(type || '').trim();
        const value = this.descriptors.get(id);
        if (!value) throw this.#error('WORKFLOW_MODULE_UNKNOWN', `Module không được hỗ trợ: ${id || '<trống>'}`);
        return immutableClone(value);
    }

    list() {
        return [...this.descriptors.values()].sort((a, b) => a.type.localeCompare(b.type)).map(immutableClone);
    }

    #validate(descriptor) {
        if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
            throw this.#error('WORKFLOW_MODULE_DESCRIPTOR_INVALID', 'Module descriptor must be an object.');
        }
        const type = String(descriptor.type || '').trim();
        if (!ID.test(type)) throw this.#error('WORKFLOW_MODULE_DESCRIPTOR_INVALID', `Invalid module type: ${type}`);
        const capability = descriptor.capability == null ? null : String(descriptor.capability).trim();
        if (capability && !CAPABILITY.test(capability)) throw this.#error('WORKFLOW_MODULE_DESCRIPTOR_INVALID', `Invalid capability: ${capability}`);
        const resources = Array.isArray(descriptor.transientResources) ? [...new Set(descriptor.transientResources.map(String).map(item => item.trim()).filter(Boolean))] : [];
        for (const resource of resources) if (!RESOURCE.test(resource)) throw this.#error('WORKFLOW_MODULE_DESCRIPTOR_INVALID', `Invalid transient resource: ${resource}`);
        const serverProfiles = Array.isArray(descriptor.serverProfiles) && descriptor.serverProfiles.length
            ? [...new Set(descriptor.serverProfiles.map(String).map(item => item.trim()).filter(Boolean))]
            : ['generic'];
        for (const profile of serverProfiles) if (!ID.test(profile)) throw this.#error('WORKFLOW_MODULE_DESCRIPTOR_INVALID', `Invalid server profile: ${profile}`);
        if (descriptor.executor && typeof descriptor.executor.execute !== 'function') {
            throw this.#error('WORKFLOW_MODULE_EXECUTOR_INVALID', `Executor is invalid for module: ${type}`);
        }
        const executorResources = descriptor.executor?.resources;
        if (executorResources && JSON.stringify([...executorResources].map(String).sort()) !== JSON.stringify([...resources].sort())) {
            throw this.#error('WORKFLOW_MODULE_RESOURCE_MISMATCH', `Executor resources do not match descriptor: ${type}`);
        }
        return {
            type,
            label: String(descriptor.label || type),
            description: String(descriptor.description || descriptor.label || type),
            capability,
            outputType: String(descriptor.outputType || 'module-result'),
            cancellable: descriptor.cancellable !== false,
            transientResources: Object.freeze(resources.sort()),
            serverProfiles: Object.freeze(serverProfiles.sort()),
            errorCode: String(descriptor.errorCode || 'COMPOSABLE_MODE_STEP_FAILED'),
            i18nKey: String(descriptor.i18nKey || `workflow.modules.${type}.failed`),
            presentation: descriptor.presentation ? immutableClone(descriptor.presentation) : null,
            executor: descriptor.executor || null
        };
    }

    #error(code, message) {
        const error = new Error(message);
        error.code = code;
        return error;
    }
}

module.exports = ModuleRegistry;
