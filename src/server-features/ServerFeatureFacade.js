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
    procedureRecording() { return this.#require('procedureRecording'); }
    quantityStrategy() { return this.#require('quantityStrategy'); }
    craftingTrace() { return this.#require('craftingTrace'); }
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
