'use strict';

class B5AutomationRuntimeDecorator {
    constructor({ service, workloadMetrics = null }) {
        if (!service?.runNext) throw new TypeError('B5AutomationRuntimeDecorator service is required.');
        this.service = service;
        this.workloadMetrics = workloadMetrics;
    }

    status() { return this.service.status(); }
    run(...args) { return this.#measure(() => this.service.run(...args)); }
    runNext(...args) { return this.#measure(() => this.service.runNext(...args)); }
    runMaintenance(...args) { return this.#measure(() => this.service.runMaintenance(...args)); }

    reconfigure(config = {}) {
        const next = config || {};
        this.service.config = next;
        this.service.inventoryState.config = next;
        this.service.recipeResolver.config = next;
        this.service.flows.plan.reconfigure?.(next);
        this.service.flows.b2Input.reconfigure?.({ source: next.b2InputSource === 'inventory' ? 'inventory' : 'storage' });
        return next;
    }

    #measure(action) {
        return this.workloadMetrics ? this.workloadMetrics.measure('b5.cycle', action) : action();
    }
}

module.exports = B5AutomationRuntimeDecorator;
