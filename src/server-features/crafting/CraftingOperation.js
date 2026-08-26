'use strict';

const Timeout = require('../../shared/time/Timeout');
const FlowError = require('../../shared/errors/FlowError');
const { findContainerSlot, isContainerSlot } = require('../../gui/ContainerSlotRange');
const CraftingOutcomeClassifier = require('./CraftingOutcomeClassifier');

class CraftingOperation {
    constructor({
        commandService,
        guiManager,
        context = null,
        itemResolver,
        recipeRegistry,
        quantityResolver,
        resultVerifier,
        guiKnowledge = null,
        config,
        logger = null
    }) {
        Object.assign(this, {
            commandService,
            guiManager,
            context,
            itemResolver,
            recipeRegistry,
            quantityResolver,
            resultVerifier,
            guiKnowledge,
            logger
        });
        this.config = this.#validateConfig(config);
    }

    async execute(recipeId, amount, {
        cancellationToken = null,
        expectedGeneration = null,
        operationContext = null,
        reconciliationBaseline = null,
        inputSourceOverrides = null
    } = {}) {
        cancellationToken = operationContext?.cancellation?.token || cancellationToken;
        expectedGeneration = expectedGeneration ?? operationContext?.connectionGeneration ?? this.context?.getGeneration?.() ?? null;
        cancellationToken?.throwIfCancelled?.();
        this.#assertGeneration(expectedGeneration);
        const recipe = this.recipeRegistry.require(recipeId);
        const quantity = this.#normalizeQuantity(amount);
        const baseDetails = { recipeId, amount: quantity, outputId: recipe.output, outputAmount: recipe.outputAmount || 1 };
        let stage = 'capture-before';
        let before = null;
        const startedAt = Date.now();
        this.#trace('CRAFT START', stage, { recipeId, quantity: quantity, resource: recipe.output, phase: 'START' });
        try {
            before = this.resultVerifier.before(recipe.output, Object.keys(recipe.inputs || {}), {
                inventorySource: 'bot-inventory',
                connectionGeneration: expectedGeneration
            });
            this.#trace('CRAFT SNAPSHOT BEFORE', stage, {
                recipeId, quantity: quantity, resource: recipe.output, phase: 'OK',
                before: before?.countsBySource || null
            });

            stage = 'open-minerals-root';
            this.#trace('CRAFT OPEN /ks', stage, { recipeId, quantity: quantity, resource: recipe.output, phase: 'START' });
            const rootSource = { commandKey: this.config.commandKey, command: '/ks', guiId: this.config.mineralsGuiId, clicks: [], actions: [], source: 'operation' };
            let session = await this.#openMineralsRoot(rootSource, { cancellationToken, expectedGeneration, operationContext });
            this.#assertGuiIdentity(session, this.config.mineralsGuiId, stage, baseDetails);
            this.#trace('CRAFT /ks READY', stage, { recipeId, resource: recipe.output, phase: 'OK', title: session?.window?.title || null, guiIdentity: session?.identity || null });

            stage = 'resolve-crafting-entry';
            const entrySlot = await this.#resolveEntrySlot(session, rootSource);
            this.#trace('CRAFT ENTRY RESOLVED', stage, { recipeId, resource: recipe.output, phase: 'OK', slot: entrySlot });
            if (entrySlot < 0) {
                throw this.#flow('CRAFTING_ENTRY_NOT_FOUND', stage, 'resolve menu_crafting', this.config.entryMenuItemId, {
                    ...baseDetails, gui: this.guiManager.describeCurrent()
                });
            }

            stage = 'enter-crafting-menu';
            const craftingSource = {
                commandKey: this.config.commandKey,
                command: '/ks',
                guiId: this.config.guiId,
                clicks: [entrySlot],
                actions: ['menu_crafting'],
                source: 'operation'
            };
            this.#trace('CRAFT ENTER MENU', stage, { recipeId, resource: recipe.output, phase: 'START', slot: entrySlot });
            session = await this.guiManager.clickAndWaitForTransition(entrySlot, {
                timeoutMs: this.config.guiTimeoutMs,
                cancellationToken,
                expectedGeneration,
                label: 'crafting menu click',
                requireNewWindow: true,
                settleMs: this.config.openSettleMs,
                source: craftingSource
            });

            this.#assertGuiIdentity(session, this.config.guiId, stage, baseDetails);
            this.#trace('CRAFT MENU READY', stage, { recipeId, resource: recipe.output, phase: 'OK', title: session?.window?.title || null, guiIdentity: session?.identity || null });
            if (this.guiKnowledge) {
                stage = 'learn-recipe-menu';
                this.#trace('CRAFT LEARN RECIPES', stage, { recipeId, resource: recipe.output, phase: 'START' });
                await this.guiKnowledge.learnBootstrapSlots(session, {
                    source: craftingSource,
                    entries: this.recipeRegistry.ids().map(id => {
                        const definition = this.recipeRegistry.require(id);
                        return {
                            roleId: `recipe:${id}`,
                            bootstrapSlot: definition.menuSlot ?? null,
                            logicalItemId: definition.menuItemId,
                            context: 'crafting-menu'
                        };
                    })
                });
                this.#trace('CRAFT LEARN RECIPES OK', stage, { recipeId, resource: recipe.output, phase: 'OK' });
            }

            stage = 'resolve-recipe-slot';
            const recipeSlot = await this.#resolveRecipeSlotWithRetry(session, recipeId, recipe, craftingSource);
            this.#trace('CRAFT RECIPE RESOLVED', stage, { recipeId, resource: recipe.output, phase: 'OK', slot: recipeSlot });
            if (recipeSlot < 0) {
                throw this.#flow('CRAFTING_RECIPE_NOT_FOUND', stage, 'resolve recipe slot', recipeId, {
                    ...baseDetails, menuItemId: recipe.menuItemId, gui: this.guiManager.describeCurrent()
                });
            }

            stage = 'bind-recipe-output';
            this.#trace('CRAFT BIND OUTPUT', stage, { recipeId, resource: recipe.output, phase: 'START', slot: recipeSlot });
            const selectedRecipeItem = session.window?.slots?.[recipeSlot] || null;
            if (selectedRecipeItem && this.guiKnowledge?.learnLogicalItem) {
                // The selected recipe icon is semantically authoritative: this
                // slot was resolved as recipeId/output already. Persist its
                // strong MMOItems identity before the GUI changes to the
                // quantity screen so inventory counting uses the same binding.
                await this.guiKnowledge.learnLogicalItem(recipe.output, selectedRecipeItem, {
                    source: 'crafting-recipe-selected',
                    roleId: `recipe:${recipeId}`,
                    context: 'crafting-menu'
                });
            }
            this.#trace('CRAFT BIND OUTPUT OK', stage, {
                recipeId, resource: recipe.output, phase: 'OK',
                outputIdentity: this.guiKnowledge?.getStrongIdentity?.(recipe.output) || null
            });

            stage = 'open-quantity-menu';
            const quantitySource = {
                commandKey: this.config.commandKey,
                command: '/ks',
                guiId: this.config.quantityGuiId,
                clicks: [entrySlot, recipeSlot],
                actions: ['menu_crafting', `recipe:${recipeId}`],
                source: 'operation'
            };
            this.#trace('CRAFT OPEN QUANTITY', stage, { recipeId, resource: recipe.output, phase: 'START', slot: recipeSlot });
            const quantitySession = await this.guiManager.clickAndWaitForTransition(recipeSlot, {
                timeoutMs: this.config.guiTimeoutMs,
                cancellationToken,
                expectedGeneration,
                label: `crafting recipe ${recipeId}`,
                requireNewWindow: true,
                settleMs: this.config.openSettleMs,
                source: quantitySource
            });

            this.#assertGuiIdentity(quantitySession, this.config.quantityGuiId, stage, baseDetails);
            this.#trace('CRAFT QUANTITY MENU READY', stage, { recipeId, resource: recipe.output, phase: 'OK', title: quantitySession?.window?.title || null, guiIdentity: quantitySession?.identity || null });
            stage = 'resolve-quantity';
            const quantitySlot = await this.#resolveQuantitySlot(quantitySession, quantity, quantitySource);
            this.#trace('CRAFT QUANTITY RESOLVED', stage, { recipeId, resource: recipe.output, quantity: quantity, phase: 'OK', slot: quantitySlot });

            stage = 'click-quantity';
            const bot = this.#requireBot();
            this.#trace('CRAFT PRE-CLICK DELAY', stage, {
                recipeId,
                resource: recipe.output,
                quantity: quantity,
                phase: 'WAIT',
                ticks: this.config.preQuantityClickTicks,
                slot: quantitySlot
            });
            await bot.waitForTicks(this.config.preQuantityClickTicks);
            cancellationToken?.throwIfCancelled?.();
            this.#assertGeneration(expectedGeneration);

            this.#trace('CRAFT CLICK QUANTITY', stage, { recipeId, resource: recipe.output, quantity: quantity, phase: 'START', slot: quantitySlot });
            this.resultVerifier.arm?.(before);
            await this.guiManager.click(quantitySlot, { cancellationToken, expectedGeneration });

            this.#trace('CRAFT POST-CLICK DELAY', stage, {
                recipeId,
                resource: recipe.output,
                quantity: quantity,
                phase: 'WAIT',
                ticks: this.config.postQuantityClickTicks,
                slot: quantitySlot
            });
            await bot.waitForTicks(this.config.postQuantityClickTicks);
            cancellationToken?.throwIfCancelled?.();
            this.#assertGeneration(expectedGeneration);
            if (this.config.resultDelayMs > 0) await Timeout.delay(this.config.resultDelayMs, { cancellationToken });

            stage = 'close-quantity-menu';
            const closeResult = await this.#closeQuantityWindowIfStillOpen(quantitySession, bot);
            this.#trace('CRAFT QUANTITY GUI CLOSED', stage, {
                recipeId,
                resource: recipe.output,
                quantity: quantity,
                phase: 'OK',
                ...closeResult
            });
            this.#trace('CRAFT CLICK QUANTITY OK', 'click-quantity', { recipeId, resource: recipe.output, quantity: quantity, phase: 'OK', slot: quantitySlot });

            stage = 'verify-output';
            this.#trace('CRAFT VERIFY START', stage, {
                recipeId,
                resource: recipe.output,
                quantity: quantity,
                phase: 'START',
                inventorySource: 'bot-inventory',
                currentWindowId: bot.currentWindow?.id ?? null
            });
            const minimumCrafts = quantity === 'ALL' ? 1 : quantity;
            const verification = await this.resultVerifier.after(recipe.output, before, {
                attempts: this.config.resultVerifyAttempts,
                retryMs: this.config.resultVerifyRetryMs,
                expectedDelta: Number(recipe.outputAmount || 1) * minimumCrafts,
                inventorySource: 'bot-inventory',
                connectionGeneration: expectedGeneration,
                inputRequirements: Object.fromEntries(
                    Object.entries(recipe.inputs || {}).map(([inputId, perCraft]) => [
                        inputId,
                        {
                            amount: Number(perCraft || 0) * minimumCrafts,
                            perCraft: Number(perCraft || 0),
                            source: inputSourceOverrides?.[inputId]
                                || recipe.inputSources?.[inputId]
                                || recipe.inputSource
                                || 'inventory'
                        }
                    ])
                )
            });
            if (!verification.verified) {
                const outcome = CraftingOutcomeClassifier.classify(verification, {
                    recipeId,
                    outputId: recipe.output,
                    quantity
                });
                const inputBaselines = {};
                const inputCountsBefore = {};
                for (const [inputId] of Object.entries(recipe.inputs || {})) {
                    const source = String(inputSourceOverrides?.[inputId]
                        || recipe.inputSources?.[inputId]
                        || recipe.inputSource
                        || 'inventory');
                    const supplied = reconciliationBaseline?.inputs?.[inputId] || null;
                    let count = null;
                    if (supplied && String(supplied.source || source) === source && Number.isFinite(Number(supplied.count))) {
                        count = Math.max(0, Number(supplied.count));
                    } else if (source === 'inventory') {
                        const counted = before?.inputCounts?.[inputId] || null;
                        const observed = Number(counted?.countsBySource?.['bot-inventory'] ?? counted?.count);
                        if (Number.isFinite(observed)) count = Math.max(0, observed);
                    }
                    inputBaselines[inputId] = { source, count };
                    if (Number.isFinite(count)) inputCountsBefore[inputId] = count;
                }
                const outputCountBefore = Number(before?.countsBySource?.['bot-inventory'] ?? before?.count ?? verification.before ?? 0);
                throw this.#flow('CRAFTING_OUTCOME_UNCERTAIN', stage, `reconcile quantity ${quantity}`, recipe.output, {
                    ...baseDetails,
                    expectedDelta: Number(recipe.outputAmount || 1) * (quantity === 'ALL' ? 1 : quantity),
                    before: verification.before,
                    after: verification.after,
                    reconciliationBaseline: {
                        output: { source: 'inventory', count: Math.max(0, outputCountBefore) },
                        outputCountBefore: Math.max(0, outputCountBefore),
                        inputs: inputBaselines,
                        inputCountsBefore
                    },
                    outcome,
                    attempts: verification.attempt,
                    viewsBefore: verification.beforeCountsBySource || {},
                    viewsAfter: verification.countsBySource || {},
                    learnedIdentity: verification.learnedIdentity || null,
                    verificationMode: verification.verificationMode || 'none',
                    inputEvidence: verification.inputEvidence || [],
                    eventEvidence: verification.eventEvidence || null,
                    eventOutputDelta: verification.eventEvidence?.outputDelta ?? 0,
                    eventMmoCandidates: verification.eventEvidence?.mmoCandidates || [],
                    snapshotMmoCandidates: verification.snapshotMmoCandidates || [],
                    eventIdentitySamples: verification.eventEvidence?.identitySamples || [],
                    eventCount: verification.eventEvidence?.eventCount ?? 0,
                    outputIdentity: this.guiKnowledge?.getStrongIdentity?.(recipe.output) || null,
                    outputBinding: this.guiKnowledge?.getLogicalBinding?.(recipe.output) || null,
                    inventorySync: verification.syncEvidence || null,
                    inventorySource: verification.inventorySource || 'bot-inventory',
                    currentWindowId: bot.currentWindow?.id ?? null,
                    gui: this.guiManager.describeCurrent()
                }, { retryable: false });
            }
            const actualCrafts = this.#deriveActualCrafts(recipe, quantity, verification);
            this.#trace('CRAFT OK', stage, {
                recipeId, resource: recipe.output, quantity: quantity, phase: 'OK',
                before: verification.before, after: verification.after,
                actualCrafts,
                producedAmount: actualCrafts * Number(recipe.outputAmount || 1),
                verificationMode: verification.verificationMode || null,
                elapsedMs: Date.now() - startedAt
            });
            return {
                recipeId,
                amount: quantity,
                quantityAction: quantity,
                actualCrafts,
                producedAmount: actualCrafts * Number(recipe.outputAmount || 1),
                entrySlot,
                recipeSlot,
                quantitySlot,
                verification
            };
        } catch (error) {
            if (error instanceof FlowError) throw error;
            throw FlowError.wrap(error, {
                code: error?.code || 'CRAFTING_STEP_FAILED',
                subsystem: 'crafting',
                operation: 'CraftingOperation',
                step: stage,
                action: this.#stageAction(stage, quantity),
                resource: recipe?.output || recipeId,
                details: { ...baseDetails, before: before?.countsBySource || null, gui: this.guiManager.describeCurrent?.() || null }
            });
        }
    }

    async #openMineralsRoot(rootSource, { cancellationToken = null, expectedGeneration = null, operationContext = null } = {}) {
        const current = this.guiManager.current();
        if (current?.active && current?.source?.command === '/ks'
            && (!Array.isArray(current.source.actions) || current.source.actions.length === 0)) {
            current.setSource(rootSource);
            const verified = this.#matchesGuiIdentity(current, this.config.mineralsGuiId, rootSource);
            if (verified) {
                if (this.config.openSettleMs > 0) await Timeout.delay(this.config.openSettleMs, { cancellationToken });
                return current;
            }
        }

        const attempts = Math.max(1, Number(this.config.commandOpenAttempts || 3));
        const retryMs = Math.max(0, Number(this.config.commandOpenRetryMs || 600));
        let lastError = null;

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                // Do not send /ks on top of /kho, /nung, or a nested /ks GUI.
                // This server can silently ignore commands while a container is
                // still open, which previously surfaced as compact-b1 GUI_OPEN_FAILED.
                if (this.guiManager.current()?.active) {
                    await this.guiManager.closeCurrentWindow();
                    if (this.config.commandCloseSettleMs > 0) await Timeout.delay(this.config.commandCloseSettleMs, { cancellationToken });
                }
                const { session } = await this.guiManager.performAndWaitForOpen(
                    () => this.commandService.send(this.config.commandKey, {
                        confirm: false,
                        cancellationToken,
                        expectedGeneration,
                        operationId: operationContext?.operationId || null,
                        correlationId: operationContext?.correlationId || null
                    }),
                    {
                        timeoutMs: this.config.guiTimeoutMs,
                        cancellationToken,
                        expectedGeneration,
                        label: '/ks',
                        settleMs: this.config.openSettleMs,
                        source: rootSource
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
            code: 'CRAFTING_ROOT_GUI_OPEN_FAILED',
            subsystem: 'crafting',
            operation: 'CraftingOperation',
            step: 'open-minerals-root',
            action: '/ks',
            attempt: attempts,
            details: { gui: this.guiManager.describeCurrent(), attempts }
        });
    }

    #matchesGuiIdentity(session, expectedGuiId, source = null) {
        if (!expectedGuiId || !session?.active) return true;
        if (typeof this.guiManager?.verifyIdentity !== 'function' && typeof this.guiManager?.identify !== 'function') return true;
        if (typeof this.guiManager.verifyIdentity === 'function') {
            const verification = this.guiManager.verifyIdentity(expectedGuiId, {
                session,
                source: source || session.source || null,
                minimumConfidence: 0.58
            });
            return verification?.matched === true;
        }
        const identity = this.guiManager.identify(session, {
            expectedId: expectedGuiId,
            source: source || session.source || null
        });
        return Boolean(identity?.id === expectedGuiId && Number(identity?.confidence || 0) >= 0.58);
    }

    #assertGuiIdentity(session, expectedGuiId, stage, details = {}) {
        if (!expectedGuiId || !session?.active) return;
        if (typeof this.guiManager?.verifyIdentity !== 'function' && typeof this.guiManager?.identify !== 'function') return;
        if (this.#matchesGuiIdentity(session, expectedGuiId, session.source || null)) return;
        throw this.#flow('CRAFTING_GUI_IDENTITY_MISMATCH', stage, `verify GUI ${expectedGuiId}`, expectedGuiId, {
            ...details,
            expectedGuiId,
            actualGuiId: session?.identity?.id || session?.definitionId || null,
            guiIdentity: session?.identity || null,
            gui: this.guiManager.describeCurrent?.() || null
        });
    }

    #assertGeneration(expectedGeneration) {
        if (expectedGeneration === null || expectedGeneration === undefined || !this.context) return;
        const expected = Number(expectedGeneration);
        if (this.context.has?.() && Number(this.context.getGeneration?.()) === expected) return;
        throw new FlowError('Crafting operation belongs to a stale connection generation.', {
            code: 'DISCONNECTED', subsystem: 'crafting', operation: 'CraftingOperation',
            step: 'generation-guard', retryable: true,
            details: { expectedGeneration: expected, currentGeneration: this.context.getGeneration?.() ?? null }
        });
    }

    async #resolveEntrySlot(session, source) {
        if (this.guiKnowledge) {
            return this.guiKnowledge.resolveSlot(session, {
                source,
                roleId: 'menu_crafting',
                bootstrapSlot: this.config.entrySlot,
                logicalItemId: this.config.entryMenuItemId,
                context: 'minerals-menu'
            });
        }
        return this.#fallbackEntrySlot(session.window);
    }

    async #resolveRecipeSlotWithRetry(session, recipeId, recipe, source) {
        const attempts = Math.max(1, Number(this.config.recipeLearnAttempts || 3));
        const delayMs = Math.max(0, Number(this.config.recipeLearnRetryMs || 200));
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            const slot = await this.#resolveRecipeSlot(session, recipeId, recipe, source);
            if (slot >= 0) return slot;
            if (attempt < attempts && delayMs > 0) await Timeout.delay(delayMs);
        }
        return -1;
    }

    async #resolveRecipeSlot(session, recipeId, recipe, source) {
        if (this.guiKnowledge) {
            return this.guiKnowledge.resolveSlot(session, {
                source,
                roleId: `recipe:${recipeId}`,
                bootstrapSlot: recipe?.menuSlot ?? null,
                logicalItemId: recipe.menuItemId,
                context: 'crafting-menu'
            });
        }
        return this.#fallbackRecipeSlot(session.window, recipe);
    }

    async #resolveQuantitySlot(session, amount, source) {
        // Do NOT resolve quantity buttons from GuiKnowledge fingerprints.
        // The server uses visually/custom-item-identical buttons whose only
        // meaningful difference can be numeric text (1 vs 64). GUI knowledge
        // normalizes dynamic digits, so a learned fingerprint can collapse
        // both buttons into the same identity and pick the lower slot (20).
        // Resolve from the live quantity GUI every time, with configured slots
        // used only as bootstrap fallback inside CraftingQuantityResolver.
        try {
            const candidates = this.quantityResolver.describeCandidates?.(session.window) || [];
            this.#trace('CRAFT QUANTITY CANDIDATES', 'resolve-quantity', {
                quantity: amount,
                phase: 'INFO',
                candidates: candidates.slice(0, 12)
            });

            const detected = this.quantityResolver.resolve(amount, session.window);
            if (this.guiKnowledge?.learnSlot) {
                // Keep observation/diagnostic knowledge up to date, but never
                // use it as the authority for the next quantity selection.
                await this.guiKnowledge.learnSlot(session, {
                    source,
                    roleId: `quantity:${amount}`,
                    slot: detected,
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
                    amount,
                    quantitySlots: this.config.quantitySlots || {},
                    candidates: this.quantityResolver.describeCandidates?.(session.window) || [],
                    gui: this.guiManager.describeCurrent()
                }
            });
        }
    }



    #normalizeQuantity(amount) {
        if (amount === 1 || amount === 64) return amount;
        if (typeof amount === 'string' && amount.trim().toUpperCase() === 'ALL') return 'ALL';
        throw this.#flow('CRAFTING_QUANTITY_INVALID', 'resolve-quantity', 'normalize crafting quantity', String(amount), {
            amount,
            supported: [1, 64, 'ALL']
        });
    }

    #deriveActualCrafts(recipe, quantity, verification) {
        if (quantity !== 'ALL') return Number(quantity);
        const outputAmount = Math.max(1, Number(recipe.outputAmount || 1));
        const observedOutput = Math.max(
            0,
            Number(verification?.delta || 0),
            Number(verification?.eventEvidence?.outputDelta || 0)
        );
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

        // Verification guarantees at least one craft happened. Returning one is
        // conservative when a plugin hides the exact ALL delta from the client.
        return verification?.verified ? 1 : 0;
    }

    #requireBot() {
        const bot = this.context?.require?.()
            || this.guiManager?.context?.require?.()
            || this.guiManager?.context?.get?.()
            || null;
        if (!bot || typeof bot.waitForTicks !== 'function') {
            throw this.#flow('CRAFTING_BOT_TIMING_UNAVAILABLE', 'click-quantity', 'wait for human-like quantity click timing', null, {
                preQuantityClickTicks: this.config.preQuantityClickTicks,
                postQuantityClickTicks: this.config.postQuantityClickTicks
            });
        }
        return bot;
    }

    async #closeQuantityWindowIfStillOpen(quantitySession, bot) {
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
                closedBy: 'server-transition',
                alreadyClosed: true,
                windowId: quantityWindow?.id ?? null,
                currentWindowId: currentWindow?.id ?? null
            };
        }

        this.guiManager?.syncCurrentWindow?.();
        if (typeof this.guiManager?.closeCurrentWindow === 'function') {
            await this.guiManager.closeCurrentWindow();
        } else if (typeof bot.closeWindow === 'function') {
            bot.closeWindow(currentWindow);
            this.guiManager?.close?.();
        } else if (typeof currentWindow.close === 'function') {
            currentWindow.close();
            this.guiManager?.close?.();
        } else {
            throw this.#flow('CRAFTING_QUANTITY_GUI_CLOSE_UNAVAILABLE', 'close-quantity-menu', 'close quantity GUI before inventory verification', null, {
                windowId: currentWindow?.id ?? null,
                title: currentWindow?.title ?? null
            });
        }

        return { closedBy: 'bot', alreadyClosed: false, windowId: quantityWindow?.id ?? null };
    }

    #trace(message, step, meta = {}) {
        this.logger?.info?.(message, {
            operation: 'CraftingOperation',
            step,
            action: this.#stageAction(step, meta.quantity),
            ...meta
        });
    }

    #stageAction(stage, amount) {
        const actions = {
            'capture-before': 'capture inventory before craft',
            'open-minerals-root': '/ks',
            'resolve-crafting-entry': 'resolve crafting menu entry',
            'enter-crafting-menu': 'click crafting menu entry',
            'learn-recipe-menu': 'learn recipe menu fingerprints',
            'resolve-recipe-slot': 'resolve recipe item',
            'bind-recipe-output': 'bind recipe output identity',
            'open-quantity-menu': 'click recipe item',
            'resolve-quantity': `resolve quantity ${amount}`,
            'click-quantity': `click quantity ${amount}`,
            'close-quantity-menu': 'close quantity GUI before inventory verification',
            'verify-output': 'verify inventory output'
        };
        return actions[stage] || stage;
    }

    #flow(code, step, action, resource, details, { retryable = true } = {}) {
        return new FlowError(this.#messageForCode(code, resource), {
            code, subsystem: 'crafting', operation: 'CraftingOperation', step, action, resource, details, retryable
        });
    }

    #messageForCode(code, resource) {
        const messages = {
            CRAFTING_ENTRY_NOT_FOUND: `Crafting menu entry could not be learned or found: ${resource}.`,
            CRAFTING_RECIPE_NOT_FOUND: `Crafting recipe slot not found for ${resource}.`,
            CRAFTING_OUTPUT_NOT_VERIFIED: `Crafting produced no verified inventory output for ${resource}.`,
            CRAFTING_OUTCOME_UNCERTAIN: `Crafting outcome is uncertain for ${resource}; fresh reconciliation is required before retry.`,
            CRAFTING_BOT_TIMING_UNAVAILABLE: 'Crafting cannot apply the configured tick delays because bot.waitForTicks is unavailable.',
            CRAFTING_QUANTITY_GUI_CLOSE_UNAVAILABLE: 'Crafting quantity GUI could not be closed before inventory verification.',
            CRAFTING_QUANTITY_INVALID: `Unsupported crafting quantity: ${resource}.`
        };
        return messages[code] || `Crafting failed for ${resource}.`;
    }

    #fallbackRecipeSlot(window, recipe) {
        const slots = window?.slots || [];
        const configuredSlot = recipe?.menuSlot === undefined ? null : Number(recipe.menuSlot);
        if (isContainerSlot(window, configuredSlot) && slots[configuredSlot]) return configuredSlot;
        return findContainerSlot(window, item => item && this.itemResolver.matches(item, recipe.menuItemId, 'crafting-menu').matched);
    }

    #fallbackEntrySlot(window) {
        const slots = window?.slots || [];
        if (isContainerSlot(window, this.config.entrySlot) && slots[this.config.entrySlot]) return this.config.entrySlot;
        return findContainerSlot(window, item => item && this.itemResolver.matches(item, this.config.entryMenuItemId, 'minerals-menu').matched);
    }

    #validateConfig(config) {
        if (!config || typeof config !== 'object') throw new TypeError('crafting config is required');
        for (const key of ['commandKey', 'entryMenuItemId']) {
            if (typeof config[key] !== 'string' || !config[key]) throw new Error(`crafting.${key} is required`);
        }
        for (const key of ['guiTimeoutMs', 'resultDelayMs']) {
            if (!Number.isFinite(config[key]) || config[key] < 0) throw new Error(`crafting.${key} must be a non-negative number`);
        }
        const entrySlot = config.entrySlot === undefined ? null : Number(config.entrySlot);
        if (entrySlot !== null && (!Number.isInteger(entrySlot) || entrySlot < 0)) throw new Error('crafting.entrySlot must be a non-negative integer when configured');
        return {
            ...config,
            entrySlot,
            openSettleMs: Number.isFinite(config.openSettleMs) && config.openSettleMs >= 0 ? config.openSettleMs : 150,
            recipeLearnAttempts: Number.isInteger(config.recipeLearnAttempts) && config.recipeLearnAttempts > 0 ? config.recipeLearnAttempts : 3,
            recipeLearnRetryMs: Number.isFinite(config.recipeLearnRetryMs) && config.recipeLearnRetryMs >= 0 ? config.recipeLearnRetryMs : 200,
            commandOpenAttempts: Number.isInteger(config.commandOpenAttempts) && config.commandOpenAttempts > 0 ? config.commandOpenAttempts : 3,
            commandOpenRetryMs: Number.isFinite(config.commandOpenRetryMs) && config.commandOpenRetryMs >= 0 ? config.commandOpenRetryMs : 600,
            commandCloseSettleMs: Number.isFinite(config.commandCloseSettleMs) && config.commandCloseSettleMs >= 0 ? config.commandCloseSettleMs : 350,
            resultVerifyAttempts: Number.isInteger(config.resultVerifyAttempts) && config.resultVerifyAttempts > 0 ? config.resultVerifyAttempts : 10,
            resultVerifyRetryMs: Number.isFinite(config.resultVerifyRetryMs) && config.resultVerifyRetryMs >= 0 ? config.resultVerifyRetryMs : 300,
            preQuantityClickTicks: Number.isInteger(config.preQuantityClickTicks) && config.preQuantityClickTicks >= 0 ? config.preQuantityClickTicks : 15,
            postQuantityClickTicks: Number.isInteger(config.postQuantityClickTicks) && config.postQuantityClickTicks >= 0 ? config.postQuantityClickTicks : 10
        };
    }
}

module.exports = CraftingOperation;
