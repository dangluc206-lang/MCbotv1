'use strict';

const { plainError, resultPayload } = require('../contracts/DesktopResult');

/**
 * Desktop control path for dynamic generic craft requests.
 * The renderer only names a real in-game item and a quantity; every validation,
 * planning and execution decision stays inside CraftingModeService.setCraftRequest.
 * Target list comes from CraftingTargetRegistry (generic, recipe-backed targets).
 */
class CraftingRequestUseCases {
    constructor({ bundleProvider, requireRunning } = {}) {
        if (typeof bundleProvider !== 'function' || typeof requireRunning !== 'function') {
            throw new TypeError('CraftingRequestUseCases requires bundleProvider and requireRunning.');
        }
        Object.assign(this, { bundleProvider, requireRunning });
    }

    items(botId) {
        this.requireRunning();
        const targets = this.#runtime(botId).getService?.('craftingTargetRegistry');
        if (!targets || typeof targets.targets !== 'function') {
            throw new Error(`Crafting target registry is unavailable for ${botId}.`);
        }
        const items = targets.targets()
            .filter(entry => entry?.recipe)
            .map(entry => ({ id: entry.id, displayName: entry.displayName }));
        return { items };
    }

    async set(botId, request) {
        this.requireRunning();
        try {
            return resultPayload(await this.#mode(botId).setCraftRequest(request));
        } catch (error) {
            return { success: false, error: plainError(error) };
        }
    }

    clear(botId) {
        this.requireRunning();
        try {
            const snapshot = this.#mode(botId).clearCraftRequest('desktop-operator');
            return { success: true, data: { snapshot: snapshot || null } };
        } catch (error) {
            return { success: false, error: plainError(error) };
        }
    }

    #mode(botId) {
        const service = this.#runtime(botId).getService?.('craftingMode');
        if (!service?.setCraftRequest) throw new Error(`Crafting mode is unavailable for ${botId}.`);
        return service;
    }

    #runtime(botId) {
        this.requireRunning();
        return this.bundleProvider().application.getRuntime(botId);
    }
}

module.exports = CraftingRequestUseCases;
