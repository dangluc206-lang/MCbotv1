'use strict';

const Timeout = require('../../shared/time/Timeout');
const FlowError = require('../../shared/errors/FlowError');

class KhoSellOperation {
    constructor({ commandService, guiManager, reader, config, logger = null }) {
        this.commandService = commandService;
        this.guiManager = guiManager;
        this.reader = reader;
        this.config = config;
        this.logger = logger;
        // Ownership is command-provenance for a live /kho sell session. Some
        // server clicks refresh/replace the Mineflayer GuiSession and drop its
        // source metadata even though the Sell GUI remains open. Keep ownership
        // across those transitions until close() or an explicitly different GUI
        // source is observed.
        this.sellSessionOwned = false;
    }

    async execute(logicalId, { quantity = 64, cancellationToken = null } = {}) {
        const sell = this.config?.sell;
        if (!sell || sell.enabled !== true) throw new Error('Storage sell is disabled.');
        if (!Object.prototype.hasOwnProperty.call(sell.itemAliases || {}, logicalId)) {
            throw new Error(`Storage sell item is not configured: ${logicalId}`);
        }

        const normalizedQuantity = this.#normalizeQuantity(quantity);
        if (normalizedQuantity === 'ALL' && sell.allowAll !== true) {
            throw new Error('SELL ALL is disabled for production B1.');
        }

        const session = await this.#ensureOpen({ logicalId, cancellationToken });
        const before = this.reader.read(session.window);
        const entry = before.entries?.[logicalId] || null;
        if (!entry) {
            return {
                logicalId,
                quantity: normalizedQuantity,
                skipped: true,
                reason: 'material-not-visible-in-sell-gui',
                before,
                after: before
            };
        }

        const click = this.#clickOptions(normalizedQuantity);
        let transitioned = false;
        let transitionError = null;
        try {
            await this.guiManager.clickAndWaitForTransition(entry.slot, {
                button: click.button,
                mode: click.mode,
                timeoutMs: Number(sell.updateTimeoutMs || this.config.guiTimeoutMs || 5000),
                cancellationToken,
                label: `/kho sell ${logicalId} ${normalizedQuantity}`,
                settleMs: Number(sell.resultDelayMs || 250),
                source: { commandKey: sell.commandKey, command: '/kho sell', actions: ['sell'], clicks: [entry.slot], source: 'operation' }
            });
            transitioned = true;
        } catch (error) {
            transitionError = error;
            // Some server containers update their backing data without emitting
            // the exact Mineflayer transition event. Reconcile currentWindow and
            // read the GUI again before deciding the click failed.
            if (sell.resultDelayMs > 0) await Timeout.delay(sell.resultDelayMs, { cancellationToken });
            this.guiManager.syncCurrentWindow?.();
        }

        const current = this.guiManager.syncCurrentWindow?.() || this.guiManager.current();
        if (!current) {
            this.sellSessionOwned = false;
            throw FlowError.wrap(transitionError || new Error('Sell GUI closed unexpectedly after click.'), {
                code: 'KHO_SELL_GUI_LOST', subsystem: 'storage', operation: 'KhoSellOperation',
                step: 'sell-click', action: `sell ${normalizedQuantity}`, resource: logicalId
            });
        }

        // A sale may refresh the same container or replace the GuiSession. The
        // replacement session often loses source metadata. Re-attach /kho sell
        // provenance immediately so the next sale in the same burst reuses the
        // current GUI instead of closing it and sending `/kho sell` again.
        const sellSource = this.#sellSource(entry.slot);
        const markedCurrent = this.guiManager.markCurrent?.(sellSource) || current;
        markedCurrent?.setSource?.(sellSource);
        this.sellSessionOwned = true;

        const after = this.reader.read((markedCurrent || current).window);
        const beforeEntry = before.entries?.[logicalId] || null;
        const afterEntry = after.entries?.[logicalId] || null;
        const beforeAmount = beforeEntry?.amount;
        const afterAmount = afterEntry?.amount;
        const amountReliable = beforeEntry?.amountReliable === true && afterEntry?.amountReliable === true;
        const amountChanged = amountReliable && Number.isFinite(beforeAmount) && Number.isFinite(afterAmount)
            ? afterAmount !== beforeAmount
            : null;

        if (!transitioned && amountChanged !== true) {
            throw FlowError.wrap(transitionError || new Error('Sell click produced no observable GUI update.'), {
                code: 'KHO_SELL_NOT_VERIFIED', subsystem: 'storage', operation: 'KhoSellOperation',
                step: 'sell-verify', action: `sell ${normalizedQuantity}`, resource: logicalId,
                details: { logicalId, quantity: normalizedQuantity, slot: entry.slot, beforeAmount, afterAmount }
            });
        }

        this.logger?.info?.('KHO SELL', {
            operation: 'KhoSellOperation', step: 'sell', phase: 'OK',
            material: logicalId, action: normalizedQuantity, slot: entry.slot,
            before: amountReliable ? beforeAmount : null,
            after: amountReliable ? afterAmount : null,
            amountReliable,
            amountChanged,
            transitioned
        });

        return {
            logicalId,
            quantity: normalizedQuantity,
            slot: entry.slot,
            skipped: false,
            beforeAmount,
            afterAmount,
            amountReliable,
            amountChanged,
            transitioned,
            before,
            after
        };
    }

    async close() {
        const current = this.guiManager.current();
        this.sellSessionOwned = false;
        if (!current) return false;
        await this.guiManager.closeCurrentWindow();
        const settle = Number(this.config?.sell?.closeSettleMs || 150);
        if (settle > 0) await Timeout.delay(settle);
        return true;
    }

    async #ensureOpen({ logicalId = null, cancellationToken = null } = {}) {
        const sell = this.config.sell;
        let current = this.guiManager.syncCurrentWindow?.() || this.guiManager.current();
        const source = this.#sellSource();
        const currentIsExplicitSell = current?.source?.commandKey === sell.commandKey
            || current?.source?.command === '/kho sell';
        const currentHasExplicitOtherSource = Boolean(current?.source)
            && !currentIsExplicitSell;

        if ((currentIsExplicitSell || (this.sellSessionOwned && !currentHasExplicitOtherSource))
            && current?.window && this.#hasSellEntries(current.window)) {
            const marked = this.guiManager.markCurrent?.(source) || current;
            marked?.setSource?.(source);
            this.sellSessionOwned = true;
            return marked || current;
        }

        // If another operation has explicitly claimed the current GUI (for
        // example `/kho`, `/ks`, `/nung`), old Sell ownership is stale. Never
        // infer Sell GUI from layout alone because /kho and /kho sell are nearly
        // identical on this server.
        if (currentHasExplicitOtherSource || !current) this.sellSessionOwned = false;
        const maxAttempts = Math.max(1, Number(sell.openAttempts || 3));
        const timeoutMs = Math.max(250, Number(sell.openTimeoutMs || this.config.guiTimeoutMs || 5000));
        const closeSettleMs = Math.max(0, Number(sell.closeSettleMs ?? 180));
        const openAfterCloseSettleMs = Math.max(closeSettleMs, Number(sell.openAfterCloseSettleMs ?? 1000));
        const openSettleMs = Math.max(0, Number(sell.openSettleMs ?? this.config.openSettleMs ?? 250));
        const retryDelayMs = Math.max(0, Number(sell.openRetryDelayMs ?? 700));
        const pollMs = Math.max(20, Number(sell.openPollMs ?? 50));
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            cancellationToken?.throwIfCancelled?.();
            current = this.guiManager.syncCurrentWindow?.() || this.guiManager.current();

            // /kho and /kho sell are intentionally almost identical on this
            // server. Sell GUI also omits raw materials, so layout/fingerprint
            // differences are NOT a reliable discriminator. Close the previous
            // container first; Mineflayer clears bot.currentWindow immediately.
            // Any readable container that appears after the explicit
            // `/kho sell` command is therefore command-provenance, not inferred
            // from raw visibility or a different window id/title.
            if (current) {
                await this.guiManager.closeCurrentWindow();
                if (openAfterCloseSettleMs > 0) await Timeout.delay(openAfterCloseSettleMs, { cancellationToken });
            }

            this.logger?.debug?.('KHO SELL OPEN ATTEMPT', {
                operation: 'KhoSellOperation', step: 'open-sell-gui', phase: 'START',
                action: '/kho sell', resource: logicalId, attempt, maxAttempts
            });

            try {
                const actionResult = await this.commandService.send(sell.commandKey, {
                    confirm: false,
                    cancellationToken
                });
                if (actionResult?.success === false) {
                    throw actionResult.error || new Error(actionResult.message || '/kho sell command failed.');
                }

                if (openSettleMs > 0) await Timeout.delay(openSettleMs, { cancellationToken });
                const deadline = Date.now() + timeoutMs;
                let lastSeen = null;

                while (Date.now() <= deadline) {
                    cancellationToken?.throwIfCancelled?.();
                    const session = this.guiManager.syncCurrentWindow?.() || this.guiManager.current();
                    if (session?.window) {
                        const snapshot = this.reader.read(session.window);
                        const entries = snapshot?.entries || {};
                        const entryCount = Object.keys(entries).length;
                        const targetVisible = logicalId ? Boolean(entries[logicalId]) : entryCount > 0;
                        lastSeen = {
                            windowId: session.window?.id ?? null,
                            title: session.window?.title ?? null,
                            entries: entryCount,
                            targetVisible
                        };

                        // Opening the Sell GUI must not depend on the requested
                        // material being visible. The server may expose only one
                        // sellable form of a B1 family (for example block but not
                        // loose material). Once any sellable entry is readable,
                        // command provenance proves this is the `/kho sell`
                        // session; execute() can then mark a missing target as
                        // unavailable and let the planner choose another form.
                        if (entryCount > 0) {
                            const marked = this.guiManager.markCurrent?.(source) || session;
                            marked?.setSource?.(source);
                            this.sellSessionOwned = true;
                            this.logger?.info?.('KHO SELL GUI OPEN', {
                                operation: 'KhoSellOperation', step: 'open-sell-gui', phase: 'OK',
                                action: '/kho sell', resource: logicalId, attempt,
                                windowId: session.window?.id ?? null,
                                title: session.window?.title ?? null,
                                entries: entryCount,
                                targetVisible
                            });
                            return marked || session;
                        }
                    }
                    await Timeout.delay(pollMs, { cancellationToken });
                }

                throw new Error(`/kho sell opened no readable sellable entries. Last seen: ${JSON.stringify(lastSeen)}`);
            } catch (error) {
                lastError = error;
                this.logger?.debug?.('KHO SELL GUI OPEN RETRY', {
                    operation: 'KhoSellOperation', step: 'open-sell-gui', phase: 'RETRY',
                    action: '/kho sell', resource: logicalId, attempt, maxAttempts,
                    error: error?.message || String(error),
                    gui: this.guiManager.describeCurrent?.() || null
                });
                if (attempt < maxAttempts) {
                    if (this.guiManager.current()) await this.guiManager.closeCurrentWindow();
                    if (retryDelayMs > 0) await Timeout.delay(retryDelayMs, { cancellationToken });
                }
            }
        }

        throw FlowError.wrap(lastError || new Error('/kho sell did not expose a readable Sell GUI.'), {
            code: 'KHO_SELL_GUI_OPEN_FAILED', subsystem: 'storage', operation: 'KhoSellOperation',
            step: 'open-sell-gui', action: '/kho sell', resource: logicalId, attempt: maxAttempts,
            details: { attempts: maxAttempts, logicalId, gui: this.guiManager.describeCurrent?.() || null }
        });
    }

    #sellSource(slot = null) {
        const clicks = Number.isInteger(slot) ? [slot] : [];
        return { commandKey: this.config.sell.commandKey, command: '/kho sell', clicks, actions: ['sell'], source: 'operation' };
    }

    #hasSellEntries(window, logicalId = null) {
        try {
            const entries = this.reader.read(window)?.entries || {};
            return logicalId ? Boolean(entries[logicalId]) : Object.keys(entries).length > 0;
        } catch {
            return false;
        }
    }

    #normalizeQuantity(quantity) {
        if (typeof quantity === 'string' && quantity.trim().toUpperCase() === 'ALL') return 'ALL';
        const value = Number(quantity);
        if (value === 1 || value === 64) return value;
        throw new RangeError(`Unsupported sell quantity: ${quantity}`);
    }

    #clickOptions(quantity) {
        if (quantity === 1) return { button: 0, mode: 0 };
        if (quantity === 64) return { button: 1, mode: 0 };
        return { button: 0, mode: 1 }; // Shift + left click.
    }
}

module.exports = KhoSellOperation;
