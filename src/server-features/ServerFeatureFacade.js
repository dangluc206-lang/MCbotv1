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
