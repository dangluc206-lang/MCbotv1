'use strict';

// Generic crafting read authority (slice 2).
//
// Thin wrapper over CraftPlanningService read capabilities: /kho (storage),
// /pv 2 (personal vault) and inventory views. No recipe math here; planning
// stays in CraftPlanningService. TTL ceiling is 5s via planning.dataMaxAgeMs;
// pass fresh:true to bypass cache.
class CraftReadService {
    constructor({ planning } = {}) {
        if (!planning?.readFlows) throw new TypeError('CraftReadService planning.readFlows is required.');
        if (!planning?.inspectAdditionalFresh) throw new TypeError('CraftReadService planning inspection is required.');
        this.planning = planning;
    }

    get dataMaxAgeMs() { return this.planning.dataMaxAgeMs; }

    readKho(options = {}) {
        if (!this.planning.readFlows.storage?.read) throw new TypeError('CraftReadService /kho reader is not configured.');
        return this.planning.readFlows.storage.read(options);
    }

    readPv2(options = {}) {
        if (!this.planning.readFlows.personalVault?.read) throw new TypeError('CraftReadService /pv 2 reader is not configured.');
        return this.planning.readFlows.personalVault.read(options);
    }

    readInventory() {
        if (!this.planning.readFlows.inventory?.readViews) throw new TypeError('CraftReadService inventory reader is not configured.');
        return this.planning.readFlows.inventory.readViews();
    }

    inspect(targetId, amount = 1, options = {}) {
        return this.planning.inspect(targetId, amount, options);
    }

    inspectAdditional(targetId, amount = 1, options = {}) {
        return this.planning.inspectAdditional(targetId, amount, options);
    }

    inspectAdditionalFresh(targetId, amount = 1, options = {}) {
        return this.planning.inspectAdditionalFresh(targetId, amount, options);
    }
}

module.exports = CraftReadService;
