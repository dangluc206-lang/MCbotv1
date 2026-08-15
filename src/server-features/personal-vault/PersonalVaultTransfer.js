'use strict';

class PersonalVaultTransfer {
    constructor({ guiManager, itemResolver, guiKnowledge = null, storageSlots, logger = null }) {
        if (!Number.isInteger(storageSlots) || storageSlots <= 0) {
            throw new TypeError('storageSlots must be a positive integer');
        }
        this.guiManager = guiManager;
        this.itemResolver = itemResolver;
        this.guiKnowledge = guiKnowledge;
        this.logger = logger;
        this.storageSlots = storageSlots;
    }

    async transferToInventory(logicalId, { maxStacks = Infinity } = {}) {
        const session = this.#requireSession();
        let moved = 0;
        const end = Math.min(this.storageSlots, session.window.slots.length);
        for (let slot = 0; slot < end && moved < maxStacks; slot += 1) {
            const item = session.window.slots[slot];
            if (item && await this.#matchesAndLearn(item, logicalId, 'personal-vault', `withdraw-slot:${slot}`)) {
                this.logger?.info?.('PV WITHDRAW CLICK', {
                    operation: 'PersonalVaultTransfer', step: 'withdraw-click', phase: 'START',
                    action: 'shift-click vault item', resource: logicalId, slot, itemName: item.name, count: item.count
                });
                await this.guiManager.click(slot, { button: 0, mode: 1 });
                moved += 1;
            }
        }
        return { logicalId, movedStacks: moved, direction: 'to-inventory' };
    }

    async transferFromInventory(logicalId, { maxStacks = Infinity } = {}) {
        const session = this.#requireSession();
        let moved = 0;
        const start = Math.min(this.storageSlots, session.window.slots.length);
        for (let slot = start; slot < session.window.slots.length && moved < maxStacks; slot += 1) {
            const item = session.window.slots[slot];
            if (item && await this.#matchesAndLearn(item, logicalId, 'inventory', `deposit-slot:${slot}`)) {
                this.logger?.info?.('PV DEPOSIT CLICK', {
                    operation: 'PersonalVaultTransfer', step: 'deposit-click', phase: 'START',
                    action: 'shift-click inventory item', resource: logicalId, slot, itemName: item.name, count: item.count
                });
                await this.guiManager.click(slot, { button: 0, mode: 1 });
                moved += 1;
            }
        }
        return { logicalId, movedStacks: moved, direction: 'to-vault' };
    }

    async #matchesAndLearn(item, logicalId, context, roleId) {
        let matched = false;
        if (this.guiKnowledge?.matchesLogical(item, logicalId, context)) matched = true;
        if (!matched) {
            try {
                matched = Boolean(this.itemResolver.matches(item, logicalId, context).matched);
            } catch {
                matched = false;
            }
        }
        if (matched && this.guiKnowledge?.learnLogicalItem) {
            await this.guiKnowledge.learnLogicalItem(logicalId, item, {
                source: `personal-vault-${context}`,
                roleId,
                context
            });
        }
        return matched;
    }

    #requireSession() {
        const session = this.guiManager.current();
        if (!session) throw new Error('Personal vault GUI is not open.');
        return session;
    }
}

module.exports = PersonalVaultTransfer;
