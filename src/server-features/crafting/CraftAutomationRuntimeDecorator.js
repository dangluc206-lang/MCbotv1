'use strict';

class CraftAutomationRuntimeDecorator {
    constructor({ service, workloadMetrics = null }) {
        if (!service?.runNext) throw new TypeError('CraftAutomationRuntimeDecorator service is required.');
        this.service = service;
        this.workloadMetrics = workloadMetrics;
    }

    status() { return this.service.status(); }
    run(...args) { return this.#measure(() => this.service.run(...args)); }
    runNext(...args) { return this.#measure(() => this.service.runNext(...args)); }
    runTarget(...args) { return this.#measure(() => this.service.runTarget(...args)); }
    runMaintenance(...args) { return this.#measure(() => this.service.runMaintenance(...args)); }

    reconfigure(config = {}) {
        if (typeof this.service.reconfigure === 'function') return this.service.reconfigure(config);
        const next = config || {};
        this.service.config = next;
        this.service.inventoryState.config = next;
        this.service.recipeResolver.config = next;
        this.service.flows.b2Input.reconfigure?.({ source: next.inputSource === 'inventory' ? 'inventory' : 'storage' });
        return next;
    }

    #measure(action) {
        return this.workloadMetrics ? this.workloadMetrics.measure('crafting.cycle', action) : action();
    }
}

module.exports = CraftAutomationRuntimeDecorator;
