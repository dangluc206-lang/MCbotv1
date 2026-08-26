'use strict';

class CraftingExecutionSupport {
    constructor({ resultVerifier, guiManager, context = null, logger = null, config, trace, flow }) {
        Object.assign(this, { resultVerifier, guiManager, context, logger, config, trace, flow });
    }

    reconfigure(config) { this.config = config; }

    traceInventoryTimeline(checkpoint, clickedAt, recipeId, recipe, effectiveInputSource, expectedGeneration) {
        try {
            const snapshot = this.resultVerifier.before(recipe.output, Object.keys(recipe.inputs || {}), {
                inventorySource: 'bot-inventory', connectionGeneration: expectedGeneration
            });
            const inputCounts = {};
            for (const inputId of Object.keys(recipe.inputs || {})) {
                const counted = snapshot?.inputCounts?.[inputId] || null;
                inputCounts[inputId] = Number(counted?.countsBySource?.['bot-inventory'] ?? counted?.count ?? 0);
            }
            this.trace('CRAFT INVENTORY TIMELINE', 'inventory-timeline', {
                recipeId, resource: recipe.output, phase: 'INFO', checkpoint,
                sinceClickMs: Math.max(0, Date.now() - Number(clickedAt || Date.now())),
                outputCount: Number(snapshot?.countsBySource?.['bot-inventory'] ?? snapshot?.count ?? 0),
                inputCounts,
                inputSources: Object.fromEntries(Object.keys(recipe.inputs || {}).map(inputId => [inputId, effectiveInputSource(inputId)]))
            });
        } catch (error) {
            this.logger?.debug?.('CRAFT INVENTORY TIMELINE unavailable.', { checkpoint, error: error?.message || String(error) });
        }
    }

    deriveActualCrafts(recipe, quantity, verification) {
        if (quantity !== 'ALL') return Number(quantity);
        const outputAmount = Math.max(1, Number(recipe.outputAmount || 1));
        const observedOutput = Math.max(0, Number(verification?.delta || 0), Number(verification?.eventEvidence?.outputDelta || 0));
        const outputCrafts = Math.floor(observedOutput / outputAmount);
        if (outputCrafts > 0) return outputCrafts;
        const candidates = [];
        for (const evidence of verification?.inputEvidence || []) {
            if (!evidence || evidence.ignored || !evidence.inputId) continue;
            const perCraft = Number(recipe.inputs?.[evidence.inputId] || 0);
            if (perCraft <= 0) continue;
            const consumed = Math.max(0, Number(evidence.consumed || 0));
            if (consumed > 0) candidates.push(Math.floor(consumed / perCraft));
        }
        const positive = candidates.filter(value => Number.isInteger(value) && value > 0);
        if (positive.length > 0) return Math.min(...positive);
        return verification?.verified ? 1 : 0;
    }

    requireBot() {
        const bot = this.context?.require?.()
            || this.guiManager?.context?.require?.()
            || this.guiManager?.context?.get?.()
            || null;
        if (!bot || typeof bot.waitForTicks !== 'function') {
            throw this.flow('CRAFTING_BOT_TIMING_UNAVAILABLE', 'click-quantity', 'wait for human-like quantity click timing', null, {
                preQuantityClickTicks: this.config.preQuantityClickTicks,
                postQuantityClickTicks: this.config.postQuantityClickTicks
            });
        }
        return bot;
    }

    async closeQuantityWindowIfStillOpen(quantitySession, bot) {
        const quantityWindow = quantitySession?.window || null;
        const currentWindow = bot?.currentWindow || null;
        if (!currentWindow) {
            if (this.guiManager?.current?.()?.window === quantityWindow) this.guiManager.close?.();
            return { closedBy: 'server', alreadyClosed: true, windowId: quantityWindow?.id ?? null };
        }
        const sameWindow = currentWindow === quantityWindow
            || (quantityWindow?.id != null && currentWindow?.id === quantityWindow.id);
        if (!sameWindow) {
            return {
                closedBy: 'server-transition', alreadyClosed: true,
                windowId: quantityWindow?.id ?? null, currentWindowId: currentWindow?.id ?? null
            };
        }
        this.guiManager?.syncCurrentWindow?.();
        if (typeof this.guiManager?.closeCurrentWindow === 'function') {
            await this.guiManager.closeCurrentWindow();
        } else if (typeof bot.closeWindow === 'function') {
            bot.closeWindow(currentWindow); this.guiManager?.close?.();
        } else if (typeof currentWindow.close === 'function') {
            currentWindow.close(); this.guiManager?.close?.();
        } else {
            throw this.flow('CRAFTING_QUANTITY_GUI_CLOSE_UNAVAILABLE', 'close-quantity-menu', 'close quantity GUI before inventory verification', null, {
                windowId: currentWindow?.id ?? null, title: currentWindow?.title ?? null
            });
        }
        return { closedBy: 'bot', alreadyClosed: false, windowId: quantityWindow?.id ?? null };
    }
}

module.exports = CraftingExecutionSupport;
