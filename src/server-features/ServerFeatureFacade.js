'use strict';

class ServerFeatureFacade {
    constructor(features = {}) {
        this.features = Object.freeze({ ...features });
    }

    storage() { return this.#require('storage'); }
    personalVault() { return this.#require('personalVault'); }
    minerals() { return this.#require('minerals'); }
    smelting() { return this.#require('smelting'); }
    crafting() { return this.#require('crafting'); }
    craftingPlanning() { return this.#require('craftingPlanning'); }
    craftingAutomation() { return this.#require('craftingAutomation'); }
    procedureRegistry() { return this.#require('procedureRegistry'); }
    procedureExecutor() { return this.#require('procedureExecutor'); }
    quantityStrategy() { return this.#require('quantityStrategy'); }
    craftingTrace() {
        if (this.features.craftingTrace) return this.features.craftingTrace;
        return this.#require('b5TraceRecorder');
    }
    // ponytail: generic crafting trace delegates to the same recorder instance the
    // legacy b5Trace() path exposes; dual getters keep both contracts green.
    b5Trace() {
        if (this.features.b5TraceRecorder) return this.features.b5TraceRecorder;
        return this.#require('craftingTrace');
    }
    b5Planning() { return this.#require('b5Planning'); }
    b5Automation() { return this.#require('b5Automation'); }
    island() { return this.#require('island'); }
    dungeon() { return this.#require('dungeon'); }
    skyblock() { return this.#require('skyblock'); }
    afkAreas() { return this.#require('afkAreas'); }
    fishing() { return this.#require('fishing'); }

    #require(name) {
        const value = this.features[name];
        if (!value) throw new Error(`Server feature not available: ${name}`);
        return value;
    }
}

module.exports = ServerFeatureFacade;
