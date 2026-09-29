'use strict';

const PersonalVaultReadFlow = require('../../personal-vault/PersonalVaultReadFlow');
const InventoryReadFlow = require('../../inventory/InventoryReadFlow');
const CraftKhoReadFlow = require('./CraftKhoReadFlow');

class CraftReadFlow {
    constructor({
        planningService,
        storage = null,
        personalVault = null,
        inventoryReader = null,
        kho = null,
        pv2 = null,
        inventory = null
    }) {
        if (!planningService) throw new TypeError('CraftReadFlow planningService is required.');
        this.planningService = planningService;

        // Read capabilities are optional until the corresponding method is used.
        // Automation commonly gets /kho + inventory through planningService and
        // only needs a direct PV2 read for post-deposit verification. Eagerly
        // constructing every reader made unrelated unit/runtime compositions fail
        // even when that capability was never called.
        this.kho = kho || (storage?.read ? new CraftKhoReadFlow({ storage }) : null);
        this.pv2 = pv2 || (personalVault?.read ? new PersonalVaultReadFlow({ personalVault }) : null);
        this.inventory = inventory || (inventoryReader?.read ? new InventoryReadFlow({ inventoryReader }) : null);
    }

    readKho(options = {}) {
        if (!this.kho) throw new TypeError('CraftReadFlow /kho reader is not configured.');
        return this.kho.read(options);
    }

    readPv2(options = {}) {
        if (!this.pv2) throw new TypeError('CraftReadFlow /pv 2 reader is not configured.');
        return this.pv2.read(options);
    }

    readInventory() {
        if (!this.inventory) throw new TypeError('CraftReadFlow inventory reader is not configured.');
        return this.inventory.readPrimary();
    }

    inspect(amount = 1, { additional = true, ...options } = {}) {
        // Generic planning addresses its target as the first argument; legacy
        // planning takes (amount, { targetId }) instead. The caller contract
        // stays amount-first either way: the target travels inside options and
        // is only lifted out for the generic call shape.
        if (this.#isGenericPlanning()) {
            const { targetId, ...rest } = options;
            return additional
                ? this.planningService.inspectAdditional(targetId, amount, rest)
                : this.planningService.inspect(targetId, amount, rest);
        }
        return additional
            ? this.planningService.inspectAdditional(amount, options)
            : this.planningService.inspect(amount, options);
    }

    inspectFresh(amount = 1, { additional = true, ...options } = {}) {
        if (this.#isGenericPlanning()) {
            const { targetId, ...rest } = options;
            if (additional && typeof this.planningService.inspectAdditionalFresh === 'function') {
                return this.planningService.inspectAdditionalFresh(targetId, amount, rest);
            }
            return this.planningService.inspect(targetId, amount, { ...rest, fresh: true });
        }
        if (additional && typeof this.planningService.inspectAdditionalFresh === 'function') {
            return this.planningService.inspectAdditionalFresh(amount, options);
        }
        return this.inspect(amount, { additional, ...options, fresh: true });
    }

    // CraftPlanningService exposes plan(targetId, ...); the B5 compatibility
    // planning boundary only exposes inspect*(amount, { targetId }).
    #isGenericPlanning() {
        return typeof this.planningService?.plan === 'function';
    }
}

module.exports = CraftReadFlow;
