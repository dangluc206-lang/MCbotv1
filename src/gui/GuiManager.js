'use strict';

const GuiSession = require('./GuiSession');
const TimeoutError = require('../shared/errors/TimeoutError');
const FlowError = require('../shared/errors/FlowError');

class GuiManager {
    constructor({ botId, context, state, detector, clickQueue, clickGuard, clickExecutor, clickVerifier, eventBus = null, logger = null }) {
        Object.assign(this, { botId, context, state, detector, clickQueue, clickGuard, clickExecutor, clickVerifier, eventBus, logger });
        this.session = null;
        this.cleanup = [];
        this.windowCleanup = null;
    }

    async initialize() {
        const bot = this.context.get();
        if (bot) this.bind(bot);
        if (this.eventBus) {
            const off = this.eventBus.on('connection:spawned', event => {
                if (event.botId === this.botId) {
                    const current = this.context.get();
                    if (current) this.bind(current);
                }
            });
            this.cleanup.push(off);
        }
    }

    bind(bot) {
        let cleaned = false;
        const open = window => this.open(window);
        const close = () => this.close();
        const onEnd = () => {
            cleanup();
            this.close();
        };
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            bot.off?.('windowOpen', open);
            bot.off?.('windowClose', close);
            bot.off?.('end', onEnd);
        };

        bot.on?.('windowOpen', open);
        bot.on?.('windowClose', close);
        bot.on?.('end', onEnd);
        this.cleanup.push(cleanup);
    }

    open(window) {
        this.#unbindWindowUpdates();
        this.session?.invalidate();

        const detected = this.detector.detect(window);
        this.session = new GuiSession({
            botId: this.botId,
            generation: this.context.getGeneration(),
            window,
            definitionId: detected?.id || null
        });

        this.#bindWindowUpdates(window, this.session.id);
        this.state.patch({
            window: {
                title: window.title,
                type: window.type,
                slotCount: window.slots?.length || 0
            },
            sessionId: this.session.id,
            lastUpdateAt: Date.now(),
            revision: Number(this.state.get().revision || 0) + 1
        });
        this.eventBus?.emit('gui:opened', {
            botId: this.botId,
            sessionId: this.session.id,
            definitionId: detected?.id || null
        });
        this.logger?.info?.('GUI OPEN', {
            operation: 'GuiManager',
            step: 'window-open',
            phase: 'OK',
            action: 'windowOpen',
            windowId: window?.id ?? null,
            title: window?.title ?? null,
            definitionId: detected?.id || null,
            slotCount: window?.slots?.length || 0
        });
        return this.session;
    }

    update(sessionId = this.session?.id) {
        if (!this.session || this.session.id !== sessionId) return;
        this.state.patch({
            lastUpdateAt: Date.now(),
            revision: Number(this.state.get().revision || 0) + 1
        });
        this.eventBus?.emit('gui:updated', {
            botId: this.botId,
            sessionId: this.session.id,
            definitionId: this.session.definitionId || null
        });
    }

    close() {
        this.#unbindWindowUpdates();
        if (!this.session) return;
        const id = this.session.id;
        const closing = this.describeCurrent();
        this.logger?.info?.('GUI CLOSE', {
            operation: 'GuiManager',
            step: 'window-close',
            phase: 'START',
            action: 'close GUI',
            windowId: closing.windowId,
            title: closing.title
        });
        this.session.invalidate();
        this.session = null;
        const revision = Number(this.state.get().revision || 0) + 1;
        this.state.reset({ window: null, sessionId: null, lastUpdateAt: Date.now(), revision });
        this.eventBus?.emit('gui:closed', { botId: this.botId, sessionId: id });
    }

    current() {
        return this.session;
    }

    describeCurrent() {
        const session = this.current();
        const window = session?.window || this.context.get?.()?.currentWindow || null;
        const slots = Array.isArray(window?.slots) ? window.slots : [];
        const occupiedSlots = [];
        for (let slot = 0; slot < slots.length && occupiedSlots.length < 60; slot += 1) {
            if (slots[slot]) occupiedSlots.push(slot);
        }
        return {
            active: Boolean(session?.active),
            sessionId: session?.id || null,
            definitionId: session?.definitionId || null,
            source: session?.source || null,
            windowId: window?.id ?? null,
            title: window?.title ?? null,
            type: window?.type ?? null,
            slotCount: slots.length,
            inventoryStart: Number.isInteger(window?.inventoryStart) ? window.inventoryStart : null,
            inventoryEnd: Number.isInteger(window?.inventoryEnd) ? window.inventoryEnd : null,
            occupiedSlots,
            revision: Number(this.state.get().revision || 0),
            lastUpdateAt: Number(this.state.get().lastUpdateAt || 0) || null
        };
    }

    markCurrent(source) {
        if (!this.session) return null;
        this.session.setSource(source);
        return this.session;
    }

    /**
     * Reconciles GuiManager state with Mineflayer's currentWindow without
     * requiring a windowOpen event. Command-driven GUI flows use this as a
     * last-mile source of truth when a server replaces/refreshes a container
     * without producing the exact transition event we expected.
     */
    syncCurrentWindow() {
        const bot = this.context.get?.();
        const window = bot?.currentWindow || null;
        if (!window) return this.current();

        let session = this.current();
        if (!session || session.window !== window) session = this.open(window);
        return session;
    }

    async closeCurrentWindow() {
        const session = this.current();
        if (!session) return false;

        const bot = this.context.get?.();
        try {
            bot?.closeWindow?.(session.window);
        } finally {
            // Keep local GUI state deterministic even when the server/client
            // does not emit windowClose for a programmatic close.
            if (this.current()?.id === session.id) this.close();
        }
        return true;
    }

    waitFor(definitionId = null, timeoutMs = 5000, cancellationToken = null) {
        const current = this.current();
        if (current && (!definitionId || current.definitionId === definitionId)) return Promise.resolve(current);
        if (!this.eventBus) return Promise.reject(new Error('GUI event bus is unavailable.'));

        return new Promise((resolve, reject) => {
            let done = false;
            let unsubscribe = () => {};
            const finish = (fn, value) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                off();
                unsubscribe();
                fn(value);
            };
            const off = this.eventBus.on('gui:opened', event => {
                if (event.botId !== this.botId) return;
                if (definitionId && event.definitionId !== definitionId) return;
                finish(resolve, this.current());
            });
            const timer = setTimeout(
                () => finish(reject, new Error(`GUI did not open: ${definitionId || 'any'}`)),
                timeoutMs
            );
            if (cancellationToken) {
                unsubscribe = cancellationToken.onCancelled(reason => finish(reject, new Error(String(reason || 'Cancelled'))));
            }
        });
    }

    waitForFresh(definitionId = null, { afterSessionId = null, afterUpdateAt = null, timeoutMs = 5000, cancellationToken = null } = {}) {
        const current = this.current();
        const currentState = this.state.get();
        const matchesDefinition = session => session && (!definitionId || session.definitionId === definitionId);
        const isFresh = session => matchesDefinition(session) && (
            (afterSessionId && session.id !== afterSessionId)
            || (afterUpdateAt !== null && Number(currentState.lastUpdateAt || 0) > Number(afterUpdateAt || 0))
            || (!afterSessionId && afterUpdateAt === null)
        );
        if (current && isFresh(current)) return Promise.resolve(current);
        if (!this.eventBus) return Promise.reject(new Error('GUI event bus is unavailable.'));

        return new Promise((resolve, reject) => {
            let done = false;
            let cancelUnsubscribe = () => {};
            const subscriptions = [];
            const finish = (fn, value) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                for (const off of subscriptions) off();
                cancelUnsubscribe();
                fn(value);
            };
            subscriptions.push(this.eventBus.on('gui:opened', event => {
                if (event.botId !== this.botId) return;
                const session = this.current();
                if (!matchesDefinition(session)) return;
                if (afterSessionId && session.id === afterSessionId) return;
                finish(resolve, session);
            }));
            subscriptions.push(this.eventBus.on('gui:updated', event => {
                if (event.botId !== this.botId) return;
                const session = this.current();
                if (!matchesDefinition(session) || event.sessionId !== session.id) return;
                const updatedAt = Number(this.state.get().lastUpdateAt || 0);
                if (afterUpdateAt !== null && updatedAt <= Number(afterUpdateAt || 0)) return;
                finish(resolve, session);
            }));
            const timer = setTimeout(
                () => finish(reject, new Error(`GUI did not refresh: ${definitionId || 'any'}`)),
                timeoutMs
            );
            if (cancellationToken) {
                cancelUnsubscribe = cancellationToken.onCancelled(reason => finish(reject, new Error(String(reason || 'Cancelled'))));
            }
        });
    }

    /**
     * Runs an action that is expected to open a GUI and returns the next
     * Mineflayer window session. No title/layout/type matching is required:
     * the action itself is the context that identifies the GUI.
     */
    async performAndWaitForOpen(action, {
        timeoutMs = 5000,
        cancellationToken = null,
        label = 'GUI action',
        source = null,
        settleMs = 0
    } = {}) {
        if (typeof action !== 'function') throw new TypeError('GUI action must be a function.');
        const bot = this.context.get?.();
        const beforeDiagnostic = this.describeCurrent();
        const beforeSessionId = this.current()?.id || null;
        const beforeWindow = bot?.currentWindow || this.current()?.window || null;
        const startedAt = Date.now();
        this.logger?.info?.('GUI ACTION START', {
            operation: 'GuiManager', step: 'open', phase: 'START', action: label,
            beforeWindowId: beforeDiagnostic.windowId, beforeTitle: beforeDiagnostic.title
        });
        const waiter = this.#createNextOpenWaiter({
            afterSessionId: beforeSessionId,
            beforeWindow,
            timeoutMs,
            cancellationToken,
            label
        });

        try {
            const actionResult = await action();
            if (actionResult?.success === false) {
                throw actionResult.error || new Error(actionResult.message || `${label} failed.`);
            }

            const session = await waiter.promise;
            if (source) session.setSource(source);
            if (settleMs > 0) await this.#delay(settleMs, cancellationToken);
            this.logger?.info?.('GUI ACTION OK', {
                operation: 'GuiManager', step: 'open', phase: 'OK', action: label,
                elapsedMs: Date.now() - startedAt,
                windowId: session?.window?.id ?? null,
                title: session?.window?.title ?? null
            });
            return { session, actionResult };
        } catch (error) {
            waiter.cancel(error);
            await waiter.promise.catch(() => {});
            throw FlowError.wrap(error, {
                code: 'GUI_OPEN_FAILED', subsystem: 'gui', operation: 'GuiManager', step: 'open', action: label,
                details: { timeoutMs, before: beforeDiagnostic, after: this.describeCurrent() }
            });
        }
    }

    /**
     * Runs an action that is expected to change GUI state and returns the
     * resulting session. Unlike performAndWaitForOpen(), this accepts either
     * a newly opened window or an in-place slot update on the current window.
     * The action itself provides semantic context; no title/type matching is
     * performed.
     */
    async performAndWaitForTransition(action, {
        timeoutMs = 5000,
        cancellationToken = null,
        label = 'GUI action',
        source = null,
        settleMs = 0
    } = {}) {
        if (typeof action !== 'function') throw new TypeError('GUI action must be a function.');
        const before = this.current();
        const beforeDiagnostic = this.describeCurrent();
        if (!before) {
            return this.performAndWaitForOpen(action, {
                timeoutMs,
                cancellationToken,
                label,
                source,
                settleMs
            });
        }

        const beforeRevision = Number(this.state.get().revision || 0);
        const waiter = this.#createTransitionWaiter({
            afterSessionId: before.id,
            afterRevision: beforeRevision,
            timeoutMs,
            cancellationToken,
            label
        });

        try {
            const actionResult = await action();
            if (actionResult?.success === false) {
                throw actionResult.error || new Error(actionResult.message || `${label} failed.`);
            }

            const session = await waiter.promise;
            if (source) session.setSource(source);
            if (settleMs > 0) await this.#delay(settleMs, cancellationToken);
            return { session, actionResult };
        } catch (error) {
            waiter.cancel(error);
            await waiter.promise.catch(() => {});
            throw FlowError.wrap(error, {
                code: 'GUI_TRANSITION_FAILED', subsystem: 'gui', operation: 'GuiManager', step: 'transition', action: label,
                details: { timeoutMs, before: beforeDiagnostic, after: this.describeCurrent() }
            });
        }
    }

    /**
     * Runs a command/action and polls Mineflayer's currentWindow until a
     * semantic predicate accepts the resulting GUI. This is the preferred
     * primitive for custom-server GUIs where windowOpen/updateSlot events are
     * not reliable enough to be the sole source of success.
     */
    async performAndWaitForSemantic(action, {
        accept,
        timeoutMs = 5000,
        cancellationToken = null,
        label = 'GUI semantic action',
        source = null,
        settleMs = 100,
        pollMs = 50,
        attempts = 1,
        closeBeforeRetry = false
    } = {}) {
        if (typeof action !== 'function') throw new TypeError('GUI action must be a function.');
        if (typeof accept !== 'function') throw new TypeError('GUI semantic accept predicate is required.');
        const maxAttempts = Math.max(1, Number(attempts) || 1);
        const before = this.describeCurrent();
        let lastReason = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            cancellationToken?.throwIfCancelled?.();
            try {
                if (attempt > 1 && closeBeforeRetry && this.current()) await this.closeCurrentWindow();
                const actionResult = await action({ attempt, maxAttempts });
                if (actionResult?.success === false) {
                    throw actionResult.error || new Error(actionResult.message || `${label} failed.`);
                }
                if (settleMs > 0) await this.#delay(settleMs, cancellationToken);
                const deadline = Date.now() + timeoutMs;
                while (Date.now() <= deadline) {
                    cancellationToken?.throwIfCancelled?.();
                    const session = this.syncCurrentWindow();
                    if (session?.active && session.window) {
                        let accepted = false;
                        try { accepted = Boolean(await accept(session, { attempt, actionResult, before })); }
                        catch (predicateError) { lastReason = predicateError; }
                        if (accepted) {
                            if (source) session.setSource(source);
                            return { session, actionResult, attempt };
                        }
                    }
                    await this.#delay(Math.max(10, Number(pollMs) || 50), cancellationToken);
                }
                lastReason = lastReason || new TimeoutError(`${label} did not expose an acceptable GUI.`);
            } catch (error) {
                lastReason = error;
            }
            if (attempt < maxAttempts) await this.#delay(Math.max(0, Number(settleMs) || 0), cancellationToken);
        }

        throw FlowError.wrap(lastReason || new Error(`${label} failed.`), {
            code: 'GUI_SEMANTIC_TIMEOUT',
            subsystem: 'gui',
            step: 'wait-semantic-gui',
            action: label,
            attempt: maxAttempts,
            details: { before, after: this.describeCurrent(), attempts: maxAttempts }
        });
    }

    /**
     * Clicks an item and returns the GUI state produced by that click. The
     * server may open a new window or update the current window in-place.
     */
    async clickAndWaitForTransition(slot, {
        timeoutMs = 5000,
        cancellationToken = null,
        label = `slot ${slot}`,
        source = null,
        settleMs = 0,
        requireNewWindow = false,
        ...clickOptions
    } = {}) {
        const before = this.current();
        if (!before) throw new Error('No active GUI session.');
        const beforeRevision = Number(this.state.get().revision || 0);
        const waiter = requireNewWindow
            ? this.#createNextOpenWaiter({
                afterSessionId: before.id,
                beforeWindow: before.window,
                timeoutMs,
                cancellationToken,
                label
            })
            : this.#createTransitionWaiter({
                afterSessionId: before.id,
                afterRevision: beforeRevision,
                timeoutMs,
                cancellationToken,
                label
            });

        try {
            await this.click(slot, { timeoutMs, ...clickOptions });
            const session = await waiter.promise;
            if (source) session.setSource(source);
            if (settleMs > 0) await this.#delay(settleMs, cancellationToken);
            return session;
        } catch (error) {
            waiter.cancel(error);
            await waiter.promise.catch(() => {});
            throw FlowError.wrap(error, {
                code: 'GUI_CLICK_TRANSITION_FAILED', subsystem: 'gui', operation: 'GuiManager', step: 'click-transition',
                action: label, resource: `slot:${slot}`, details: { slot, timeoutMs, requireNewWindow, gui: this.describeCurrent() }
            });
        }
    }

    click(slot, options = {}) {
        const session = this.session;
        if (!session) return Promise.reject(new FlowError('No active GUI session.', {
            code: 'GUI_NOT_OPEN', subsystem: 'gui', operation: 'GuiManager', step: 'click',
            action: `click slot ${slot}`, resource: `slot:${slot}`, details: { gui: this.describeCurrent() }
        }));

        return this.clickQueue.enqueue(async () => {
            this.clickGuard.assert({ session, slot });
            const clickedItem = session.window?.slots?.[slot] || null;
            const startedAt = Date.now();
            this.logger?.info?.('GUI CLICK START', {
                operation: 'GuiManager', step: 'click', phase: 'START',
                action: `click slot ${slot}`, resource: `slot:${slot}`,
                slot, itemName: clickedItem?.name || null,
                windowId: session.window?.id ?? null, title: session.window?.title ?? null,
                button: options.button ?? 0, mode: options.mode ?? 0
            });
            const { verifyGui = false, ...clickOptions } = options;
            let verification = null;
            if (verifyGui) {
                verification = this.clickVerifier.verify({
                    botId: this.botId,
                    session,
                    timeoutMs: options.timeoutMs || 3000
                });
            }
            try {
                // clickWindow's promise/transaction is the transport-level ACK.
                // Business success belongs to the caller: GUI transition,
                // inventory delta, /kho delta, teleport, etc.
                const data = await this.clickExecutor.click({ slot, ...clickOptions });
                if (verification) await verification;
                this.logger?.info?.('GUI CLICK OK', {
                    operation: 'GuiManager', step: 'click', phase: 'OK',
                    action: `click slot ${slot}`, resource: `slot:${slot}`,
                    slot, itemName: clickedItem?.name || null,
                    elapsedMs: Date.now() - startedAt
                });
                return data;
            } catch (error) {
                await verification?.catch?.(() => {});
                throw FlowError.wrap(error, {
                    code: verifyGui ? 'GUI_CLICK_VERIFY_FAILED' : 'GUI_CLICK_FAILED',
                    subsystem: 'gui', operation: 'GuiManager', step: 'click',
                    action: `click slot ${slot}`, resource: `slot:${slot}`,
                    details: { slot, verifyGui, options: clickOptions, gui: this.describeCurrent() }
                });
            }
        });
    }

    #createNextOpenWaiter({ afterSessionId, beforeWindow = null, timeoutMs, cancellationToken, label }) {
        const bot = this.context.get?.();
        return this.#createEventWaiter({
            timeoutMs,
            cancellationToken,
            timeoutMessage: `${label} did not open a GUI.`,
            subscribe: finish => {
                const cleanups = [];

                const acceptWindow = window => {
                    if (!window) return;

                    let session = this.current();
                    if (!session || session.window !== window) {
                        // Mineflayer already knows about the window but the
                        // GuiManager event path may have missed windowOpen.
                        // Action context is authoritative, so adopt it.
                        session = this.open(window);
                    }

                    if (afterSessionId && session.id === afterSessionId) return;
                    finish(session);
                };

                cleanups.push(this.eventBus.on('gui:opened', event => {
                    if (event.botId !== this.botId) return;
                    if (afterSessionId && event.sessionId === afterSessionId) return;
                    const session = this.current();
                    if (!session || session.id !== event.sessionId) return;
                    finish(session);
                }));

                // Listen to Mineflayer directly as a second path. This avoids
                // losing an action GUI when the internal gui:opened bridge is
                // temporarily unbound during reconnect/runtime transitions.
                if (bot?.on) {
                    const onWindowOpen = window => acceptWindow(window);
                    bot.on('windowOpen', onWindowOpen);
                    cleanups.push(() => bot.off?.('windowOpen', onWindowOpen));
                }

                // currentWindow is the final source of truth. Mineflayer can
                // already expose it even if a windowOpen listener missed the
                // event. Polling is intentionally short-lived and exists only
                // for the duration of this command wait.
                if (bot) {
                    const poll = setInterval(() => {
                        const window = bot.currentWindow;
                        if (!window) return;

                        const session = this.current();
                        const isNewWindow = !beforeWindow || window !== beforeWindow;
                        const isNewSession = Boolean(session && (!afterSessionId || session.id !== afterSessionId));
                        if (!isNewWindow && !isNewSession) return;

                        acceptWindow(window);
                    }, 25);
                    cleanups.push(() => clearInterval(poll));
                }

                return cleanups;
            }
        });
    }

    #createTransitionWaiter({ afterSessionId, afterRevision, timeoutMs, cancellationToken, label }) {
        return this.#createEventWaiter({
            timeoutMs,
            cancellationToken,
            timeoutMessage: `${label} did not produce a GUI transition.`,
            subscribe: finish => [
                this.eventBus.on('gui:opened', event => {
                    if (event.botId !== this.botId) return;
                    if (event.sessionId === afterSessionId) return;
                    const session = this.current();
                    if (!session || session.id !== event.sessionId) return;
                    finish(session);
                }),
                this.eventBus.on('gui:updated', event => {
                    if (event.botId !== this.botId || event.sessionId !== afterSessionId) return;
                    const revision = Number(this.state.get().revision || 0);
                    if (revision <= afterRevision) return;
                    const session = this.current();
                    if (!session || session.id !== afterSessionId) return;
                    finish(session);
                })
            ]
        });
    }

    #createEventWaiter({ timeoutMs, cancellationToken, timeoutMessage, subscribe }) {
        if (!this.eventBus) throw new Error('GUI event bus is unavailable.');
        let settled = false;
        let rejectPromise = null;
        let cancelUnsubscribe = () => {};
        let subscriptions = [];
        let timer = null;

        const cleanup = () => {
            if (timer) clearTimeout(timer);
            timer = null;
            for (const off of subscriptions) off();
            subscriptions = [];
            cancelUnsubscribe();
            cancelUnsubscribe = () => {};
        };

        const promise = new Promise((resolve, reject) => {
            rejectPromise = reject;
            const finish = value => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve(value);
            };

            subscriptions = subscribe(finish);
            timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(new TimeoutError(timeoutMessage));
            }, timeoutMs);

            if (cancellationToken) {
                cancelUnsubscribe = cancellationToken.onCancelled(reason => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    reject(new Error(String(reason || 'Cancelled')));
                });
            }
        });

        return {
            promise,
            cancel(reason = 'GUI wait cancelled.') {
                if (settled) return;
                settled = true;
                cleanup();
                const error = reason instanceof Error ? reason : new Error(String(reason));
                rejectPromise(error);
            }
        };
    }

    #delay(ms, cancellationToken = null) {
        const timeout = Math.max(0, Number(ms) || 0);
        if (!cancellationToken) return new Promise(resolve => setTimeout(resolve, timeout));
        return new Promise((resolve, reject) => {
            let unsubscribe = () => {};
            const timer = setTimeout(() => {
                unsubscribe();
                resolve();
            }, timeout);
            unsubscribe = cancellationToken.onCancelled(reason => {
                clearTimeout(timer);
                unsubscribe();
                reject(new Error(String(reason || 'Cancelled')));
            });
        });
    }

    #bindWindowUpdates(window, sessionId) {
        if (!window?.on) return;
        const onUpdateSlot = () => this.update(sessionId);
        window.on('updateSlot', onUpdateSlot);
        this.windowCleanup = () => window.off?.('updateSlot', onUpdateSlot);
    }

    #unbindWindowUpdates() {
        this.windowCleanup?.();
        this.windowCleanup = null;
    }

    async stop() {
        this.#unbindWindowUpdates();
        for (const fn of this.cleanup.splice(0)) fn();
        this.close();
        await this.clickQueue.destroy();
    }

    async destroy() {
        await this.stop();
    }
}

module.exports = GuiManager;
