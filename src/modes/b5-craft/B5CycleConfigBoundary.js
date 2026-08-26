'use strict';

class B5CycleConfigBoundary {
    constructor({ planning, automation }) {
        this.planning = planning;
        this.automation = automation;
        this.pending = null;
        this.revision = 0;
    }

    queue(config, { immediate = false } = {}) {
        const next = JSON.parse(JSON.stringify(config || {}));
        if (immediate) {
            this.#apply(next);
            return { status: 'APPLIED_SAFE_BOUNDARY', revision: this.revision };
        }
        this.pending = next;
        return { status: 'QUEUED_CYCLE_BOUNDARY', revision: this.revision + 1 };
    }

    applyPending() {
        if (!this.pending) return false;
        const next = this.pending;
        this.pending = null;
        this.#apply(next);
        return true;
    }

    status() {
        return Object.freeze({ pending: this.pending !== null, revision: this.revision });
    }

    #apply(config) {
        if (typeof this.planning.reconfigure === 'function') this.planning.reconfigure(config);
        else this.planning.config = config;
        this.automation.reconfigure?.(config);
        this.revision += 1;
    }
}

module.exports = B5CycleConfigBoundary;
