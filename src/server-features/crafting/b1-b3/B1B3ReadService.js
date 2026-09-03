'use strict';

class B1B3ReadService {
    constructor({ inventory, pv2, kho } = {}) {
        if (!inventory?.readViews) {
            throw new TypeError('B1B3ReadService inventory.readViews is required.');
        }
        if (!pv2?.read) {
            throw new TypeError('B1B3ReadService pv2.read is required.');
        }
        if (!kho?.read) {
            throw new TypeError('B1B3ReadService kho.read is required.');
        }
        this.inventory = inventory;
        this.pv2 = pv2;
        this.kho = kho;
    }

    readInventory() {
        return this.inventory.readViews();
    }

    readPv2(options = {}) {
        return this.pv2.read(options);
    }

    readKho(options = {}) {
        return this.kho.read(options);
    }
}

module.exports = B1B3ReadService;
