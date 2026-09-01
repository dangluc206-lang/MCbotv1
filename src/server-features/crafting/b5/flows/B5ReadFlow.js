'use strict';

const B5KhoReadFlow = require('./B5KhoReadFlow');
const PersonalVaultReadFlow = require('../../../personal-vault/PersonalVaultReadFlow');
const InventoryReadFlow = require('../../../inventory/InventoryReadFlow');

class B5ReadFlow {
    constructor({
        planningService,
        storage = null,
        personalVault = null,
        inventoryReader = null,
        kho = null,
        pv2 = null,
        inventory = null
    }) {
        if (!planningService) throw new TypeError('B5ReadFlow planningService is required.');
        this.planningService = planningService;

        // Read capabilities are optional until the corresponding method is used.
        // B5Automation commonly gets /kho + inventory through planningService and
        // only needs a direct PV2 read for post-deposit verification. Eagerly
        // constructing every reader made unrelated unit/runtime compositions fail
        // even when that capability was never called.
        this.kho = kho || (storage?.read ? new B5KhoReadFlow({ storage }) : null);
        this.pv2 = pv2 || (personalVault?.read ? new PersonalVaultReadFlow({ personalVault }) : null);
        this.inventory = inventory || (inventoryReader?.read ? new InventoryReadFlow({ inventoryReader }) : null);
    }

    readKho(options = {}) {
        if (!this.kho) throw new TypeError('B5ReadFlow /kho reader is not configured.');
        return this.kho.read(options);
    }

    readPv2(options = {}) {
        if (!this.pv2) throw new TypeError('B5ReadFlow /pv 2 reader is not configured.');
        return this.pv2.read(options);
    }

    readInventory() {
        if (!this.inventory) throw new TypeError('B5ReadFlow inventory reader is not configured.');
        return this.inventory.readPrimary();
    }

    inspect(amount = 1, { additional = true, ...options } = {}) {
        return additional
            ? this.planningService.inspectAdditional(amount, options)
            : this.planningService.inspect(amount, options);
    }

    inspectFresh(amount = 1, { additional = true, ...options } = {}) {
        if (additional && typeof this.planningService.inspectAdditionalFresh === 'function') {
            return this.planningService.inspectAdditionalFresh(amount, options);
        }
        return this.inspect(amount, { additional, ...options, fresh: true });
    }
}

module.exports = B5ReadFlow;
