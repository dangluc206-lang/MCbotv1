'use strict';

const Timeout = require('../../shared/time/Timeout');
const FlowError = require('../../shared/errors/FlowError');
const { findContainerSlot, isContainerSlot } = require('../../gui/ContainerSlotRange');

class CraftingGuiNavigator {
    constructor({ commandService, guiManager, itemResolver, quantityResolver, guiKnowledge = null, config, trace = null, flow = null }) {
        Object.assign(this, { commandService, guiManager, itemResolver, quantityResolver, guiKnowledge, config, trace, flow });
    }

    reconfigure(config) { this.config = config; }

    async openMineralsRoot(rootSource, { cancellationToken = null, expectedGeneration = null, operationContext = null } = {}) {
        const current = this.guiManager.current();
        if (current?.active && current?.source?.command === '/ks'
            && (!Array.isArray(current.source.actions) || current.source.actions.length === 0)) {
            current.setSource(rootSource);
            if (this.matchesGuiIdentity(current, this.config.mineralsGuiId, rootSource)) {
                if (this.config.openSettleMs > 0) await Timeout.delay(this.config.openSettleMs, { cancellationToken });
                return current;
            }
        }
        const attempts = Math.max(1, Number(this.config.commandOpenAttempts || 3));
        const retryMs = Math.max(0, Number(this.config.commandOpenRetryMs || 600));
        let lastError = null;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                if (this.guiManager.current()?.active) {
                    await this.guiManager.closeCurrentWindow();
                    if (this.config.commandCloseSettleMs > 0) await Timeout.delay(this.config.commandCloseSettleMs, { cancellationToken });
                }
                const { session } = await this.guiManager.performAndWaitForOpen(
                    () => this.commandService.send(this.config.commandKey, {
                        confirm: false, cancellationToken, expectedGeneration,
                        operationId: operationContext?.operationId || null,
                        correlationId: operationContext?.correlationId || null
                    }),
                    {
                        timeoutMs: this.config.guiTimeoutMs, cancellationToken, expectedGeneration,
                        label: '/ks', settleMs: this.config.openSettleMs, source: rootSource
                    }
                );
                return session;
            } catch (error) {
                lastError = error;
                if (attempt >= attempts) break;
                if (this.guiManager.current()?.active) {
                    await this.guiManager.closeCurrentWindow();
                    if (this.config.commandCloseSettleMs > 0) await Timeout.delay(this.config.commandCloseSettleMs, { cancellationToken });
                }
                if (retryMs > 0) await Timeout.delay(retryMs, { cancellationToken });
            }
        }
        throw FlowError.wrap(lastError || new Error('/ks did not open a GUI.'), {
            code: 'CRAFTING_ROOT_GUI_OPEN_FAILED', subsystem: 'crafting', operation: 'CraftingOperation',
            step: 'open-minerals-root', action: '/ks', attempt: attempts,
            details: { gui: this.guiManager.describeCurrent(), attempts }
        });
    }

    matchesGuiIdentity(session, expectedGuiId, source = null) {
        if (!expectedGuiId || !session?.active) return true;
        if (typeof this.guiManager?.verifyIdentity !== 'function' && typeof this.guiManager?.identify !== 'function') return true;
        if (typeof this.guiManager.verifyIdentity === 'function') {
            return this.guiManager.verifyIdentity(expectedGuiId, {
                session, source: source || session.source || null, minimumConfidence: 0.58
            })?.matched === true;
        }
        const identity = this.guiManager.identify(session, { expectedId: expectedGuiId, source: source || session.source || null });
        return Boolean(identity?.id === expectedGuiId && Number(identity?.confidence || 0) >= 0.58);
    }

    assertGuiIdentity(session, expectedGuiId, stage, details = {}) {
        if (!expectedGuiId || !session?.active) return;
        if (typeof this.guiManager?.verifyIdentity !== 'function' && typeof this.guiManager?.identify !== 'function') return;
        if (this.matchesGuiIdentity(session, expectedGuiId, session.source || null)) return;
        throw this.flow('CRAFTING_GUI_IDENTITY_MISMATCH', stage, `verify GUI ${expectedGuiId}`, expectedGuiId, {
            ...details,
            expectedGuiId,
            actualGuiId: session?.identity?.id || session?.definitionId || null,
            guiIdentity: session?.identity || null,
            gui: this.guiManager.describeCurrent?.() || null
        });
    }

    async resolveEntrySlot(session, source) {
        if (this.guiKnowledge) {
            return this.guiKnowledge.resolveSlot(session, {
                source, roleId: 'menu_crafting', bootstrapSlot: this.config.entrySlot,
                logicalItemId: this.config.entryMenuItemId, context: 'minerals-menu'
            });
        }
        return this.fallbackEntrySlot(session.window);
    }

    async resolveRecipeSlotWithRetry(session, recipeId, recipe, source) {
        const attempts = Math.max(1, Number(this.config.recipeLearnAttempts || 3));
        const delayMs = Math.max(0, Number(this.config.recipeLearnRetryMs || 200));
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            const slot = await this.resolveRecipeSlot(session, recipeId, recipe, source);
            if (slot >= 0) return slot;
            if (attempt < attempts && delayMs > 0) await Timeout.delay(delayMs);
        }
        return -1;
    }

    async resolveRecipeSlot(session, recipeId, recipe, source) {
        // The server's crafting GUI presents B2 and the stone B3 with the same
        // vanilla item name. Runtime GUI knowledge cannot safely distinguish the
        // two from that display-only fingerprint. For this known collision,
        // the configured recipe slot is authoritative and the learned slot is
        // not allowed to replace it.
        if (recipeId === 'super_cobblestone_block') {
            const configuredSlot = recipe?.menuSlot === undefined ? null : Number(recipe.menuSlot);
            if (isContainerSlot(session.window, configuredSlot) && session.window?.slots?.[configuredSlot]) {
                this.trace?.('CRAFT FIXED RECIPE SLOT', 'resolve-recipe-slot', {
                    recipeId, configuredSlot, reason: 'stone-b3-fixed-slot-authority'
                });
                return configuredSlot;
            }
        }

        if (this.guiKnowledge) {
            return this.guiKnowledge.resolveSlot(session, {
                source, roleId: `recipe:${recipeId}`, bootstrapSlot: recipe?.menuSlot ?? null,
                logicalItemId: recipe.menuItemId, context: 'crafting-menu'
            });
        }
        return this.fallbackRecipeSlot(session.window, recipe);
    }

    async resolveQuantitySlot(session, amount, source) {
        try {
            const candidates = this.quantityResolver.describeCandidates?.(session.window) || [];
            this.trace?.('CRAFT QUANTITY CANDIDATES', 'resolve-quantity', {
                quantity: amount, phase: 'INFO', candidates: candidates.slice(0, 12)
            });
            const detected = this.quantityResolver.resolve(amount, session.window);
            if (this.guiKnowledge?.learnSlot) {
                await this.guiKnowledge.learnSlot(session, {
                    source, roleId: `quantity:${amount}`, slot: detected,
                    bootstrapSlot: this.config.quantitySlots?.[String(amount)] ?? null,
                    context: 'crafting-quantity'
                });
            }
            return detected;
        } catch (error) {
            throw FlowError.wrap(error, {
                code: 'CRAFTING_QUANTITY_NOT_FOUND', subsystem: 'crafting', operation: 'CraftingOperation',
                step: 'resolve-quantity', action: `resolve quantity ${amount}`, resource: String(amount),
                details: {
                    amount, quantitySlots: this.config.quantitySlots || {},
                    candidates: this.quantityResolver.describeCandidates?.(session.window) || [],
                    gui: this.guiManager.describeCurrent()
                }
            });
        }
    }

    fallbackRecipeSlot(window, recipe) {
        const slots = window?.slots || [];
        const configuredSlot = recipe?.menuSlot === undefined ? null : Number(recipe.menuSlot);
        if (isContainerSlot(window, configuredSlot) && slots[configuredSlot]) return configuredSlot;
        return findContainerSlot(window, item => item && this.itemResolver.matches(item, recipe.menuItemId, 'crafting-menu').matched);
    }

    fallbackEntrySlot(window) {
        const slots = window?.slots || [];
        if (isContainerSlot(window, this.config.entrySlot) && slots[this.config.entrySlot]) return this.config.entrySlot;
        return findContainerSlot(window, item => item && this.itemResolver.matches(item, this.config.entryMenuItemId, 'minerals-menu').matched);
    }
}

module.exports = CraftingGuiNavigator;
