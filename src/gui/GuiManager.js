'use strict';

const GuiSession = require('./GuiSession');
const GuiWindowSessionBinding = require('./GuiWindowSessionBinding');
const TimeoutError = require('../shared/errors/TimeoutError');
const OperationCancelledError = require('../shared/errors/OperationCancelledError');
const FlowError = require('../shared/errors/FlowError');
const { normalizeConnectionGeneration } = require('../core/events/EventEnvelope');

class GuiManager {
    constructor({ botId, context, state, detector, clickQueue, clickGuard, clickExecutor, clickVerifier, eventBus = null, logger = null, workloadMetrics = null }) {
        Object.assign(this, { botId, context, state, detector, clickQueue, clickGuard, clickExecutor, clickVerifier, eventBus, logger, workloadMetrics });
        this.session = null;
        this.lastWindowClosedAt = 0;
        this.windowBinding = new GuiWindowSessionBinding({
            botId, context, eventBus,
            currentSession: () => this.session,
            onOpen: (window, options) => this.open(window, options),
            onClose: () => this.close(),
            onUpdate: sessionId => this.update(sessionId)
        });
    }

    async initialize() {
        this.windowBinding.initialize();
    }

    bind(bot, generation = this.context.getGeneration()) {
        this.windowBinding.bind(bot, generation);
    }

    open(window, { client = this.context.get?.(), connectionGeneration = this.context.getGeneration?.() } = {}) {
        const generation = Number(connectionGeneration);
        const currentClient = this.context.get?.() || null;
        if ((currentClient && client && client !== currentClient) || generation !== Number(this.context.getGeneration?.())) return this.session;
        this.windowBinding.unbindWindow();
        this.session?.invalidate();

        const detected = this.detector.detect(window, { previousId: this.session?.definitionId || null });
        this.session = new GuiSession({
            botId: this.botId,
            connectionGeneration: generation,
            client,
            window,
            definitionId: detected?.id || null,
            identity: detected || null
        });

        this.windowBinding.bindWindow(window, this.session.id);
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
            connectionGeneration: generation,
            sessionId: this.session.id,
            definitionId: detected?.id || null,
            identityConfidence: detected?.confidence ?? 0,
            identityAmbiguous: detected?.ambiguous === true
        });
        this.logger?.info?.('GUI OPEN', {
            operation: 'GuiManager',
            step: 'window-open',
            phase: 'OK',
            action: 'windowOpen',
            windowId: window?.id ?? null,
            title: window?.title ?? null,
            definitionId: detected?.id || null,
            identityConfidence: detected?.confidence ?? 0,
            identityMargin: detected?.margin ?? 0,
            identityCandidateId: detected?.candidateId || null,
            slotCount: window?.slots?.length || 0
        });
        return this.session;
    }

    update(sessionId = this.session?.id) {
        if (!this.session || this.session.id !== sessionId) return;
        if (!this.#isSessionCurrent(this.session)) return;
        this.identify(this.session, { source: this.session.source, expectedId: this.session.source?.guiId || null });
        this.state.patch({
            lastUpdateAt: Date.now(),
            revision: Number(this.state.get().revision || 0) + 1
        });
        this.eventBus?.emit('gui:updated', {
            botId: this.botId,
            connectionGeneration: this.session.connectionGeneration,
            sessionId: this.session.id,
            definitionId: this.session.definitionId || null,
            identityConfidence: this.session.identity?.confidence ?? 0
        });
    }

    close() {
        this.windowBinding.unbindWindow();
        if (!this.session) return;
        const id = this.session.id;
        const generation = this.session.connectionGeneration;
        this.lastWindowClosedAt = Date.now();
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
        this.eventBus?.emit('gui:closed', { botId: this.botId, connectionGeneration: generation, sessionId: id });
    }

    postCloseAgeMs(now = Date.now()) {
        return this.lastWindowClosedAt > 0 ? Math.max(0, Number(now) - this.lastWindowClosedAt) : Infinity;
    }

    async waitForPostCloseSettle(minSettleMs = 0, { cancellationToken = null } = {}) {
        const minimum = Math.max(0, Number(minSettleMs) || 0);
        const age = this.postCloseAgeMs();
        if (!Number.isFinite(age) || age >= minimum) return 0;
        const waitMs = Math.max(0, minimum - age);
        if (waitMs > 0) await this.#delay(waitMs, cancellationToken);
        return waitMs;
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
            connectionGeneration: session?.connectionGeneration ?? null,
            definitionId: session?.definitionId || null,
            identity: session?.identity ? {
                id: session.identity.id || null,
                candidateId: session.identity.candidateId || null,
                confidence: session.identity.confidence ?? 0,
                margin: session.identity.margin ?? 0,
                ambiguous: session.identity.ambiguous === true,
                reason: session.identity.reason || null,
                expectedId: session.identity.expectedId || null
            } : null,
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
        this.identify(this.session, { source, expectedId: source?.guiId || source?.definitionId || null });
        return this.session;
    }

    identify(session = this.current(), { expectedId = null, source = null, semanticEvidence = [] } = {}) {
        if (!session?.window) return null;
        const effectiveSource = source || session.source || null;
        const identity = this.detector.detect(session.window, {
            expectedId: expectedId || effectiveSource?.guiId || effectiveSource?.definitionId || null,
            source: effectiveSource,
            previousId: session.definitionId || session.identity?.candidateId || null,
            semanticEvidence
        });
        session.setIdentity?.(identity);
        return identity;
    }

    verifyIdentity(expectedId, { session = this.current(), source = null, semanticEvidence = [], minimumConfidence = null } = {}) {
        if (!session?.active || !session.window || typeof expectedId !== 'string' || !expectedId) {
            return { matched: false, identity: null, session: session || null };
        }
        const identity = this.identify(session, { expectedId, source, semanticEvidence });
        const threshold = minimumConfidence === null || minimumConfidence === undefined ? 0 : Number(minimumConfidence);
        return {
            matched: Boolean(identity?.id === expectedId && Number(identity?.confidence || 0) >= Math.max(0, threshold || 0)),
            identity,
            session
        };
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

    waitFor(definitionId = null, timeoutMs = 5000, cancellationToken = null, expectedGeneration = this.#currentGeneration()) {
        const expected = Number(expectedGeneration);
        // currentWindow is the client-side source of truth for an already-open
        // container. Reconcile it before deciding whether an event wait is
        // needed so a missed gui:opened bridge cannot manufacture a timeout.
        const current = this.syncCurrentWindow();
        if (current && this.#isSessionCurrent(current) && Number(current.connectionGeneration) === expected
            && (!definitionId || current.definitionId === definitionId)) return Promise.resolve(current);
        if (!this.eventBus) return Promise.reject(new Error('GUI event bus is unavailable.'));

        return new Promise((resolve, reject) => {
            let done = false;
            let cancelUnsubscribe = () => {};
            const subscriptions = [];
            const finish = (fn, value) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                for (const off of subscriptions.splice(0)) off();
                cancelUnsubscribe();
                fn(value);
            };
            subscriptions.push(this.eventBus.on('gui:opened', event => {
                if (event.botId !== this.botId) return;
                if (normalizeConnectionGeneration(event) !== expected || !this.#isExpectedCurrent(expected)) return;
                if (definitionId && event.definitionId !== definitionId) return;
                const session = this.current();
                if (!session || Number(session.connectionGeneration) !== expected || !this.#isSessionCurrent(session)) return;
                finish(resolve, session);
            }));
            subscriptions.push(this.eventBus.on('connection:ended', event => {
                if (event.botId !== this.botId || normalizeConnectionGeneration(event) !== expected) return;
                finish(reject, new FlowError('Connection ended while waiting for GUI.', {
                    code: 'GUI_WAIT_DISCONNECTED', subsystem: 'gui', operation: 'GuiManager', step: 'wait-open', retryable: true,
                    details: { expectedGeneration: expected }
                }));
            }));
            const timer = setTimeout(
                () => finish(reject, new Error(`GUI did not open: ${definitionId || 'any'}`)),
                timeoutMs
            );
            if (cancellationToken) {
                cancelUnsubscribe = cancellationToken.onCancelled(reason => finish(reject, new OperationCancelledError(String(reason || 'Cancelled'))));
            }
        });
    }

    waitForFresh(definitionId = null, { afterSessionId = null, afterUpdateAt = null, timeoutMs = 5000, cancellationToken = null, expectedGeneration = this.#currentGeneration() } = {}) {
        const expected = Number(expectedGeneration);
        // A replacement currentWindow is sufficient evidence of a fresh GUI
        // session even when the open bridge event was missed. Same-window
        // freshness still requires revision/update evidence below.
        const current = this.syncCurrentWindow();
        const currentState = this.state.get();
        const matchesDefinition = session => session && (!definitionId || session.definitionId === definitionId);
        const isFresh = session => this.#isSessionCurrent(session) && Number(session.connectionGeneration) === expected && matchesDefinition(session) && (
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
                if (normalizeConnectionGeneration(event) !== expected || !this.#isExpectedCurrent(expected)) return;
                const session = this.current();
                if (!matchesDefinition(session)) return;
                if (afterSessionId && session.id === afterSessionId) return;
                finish(resolve, session);
            }));
            subscriptions.push(this.eventBus.on('gui:updated', event => {
                if (event.botId !== this.botId) return;
                if (normalizeConnectionGeneration(event) !== expected || !this.#isExpectedCurrent(expected)) return;
                const session = this.current();
                if (!matchesDefinition(session) || event.sessionId !== session.id) return;
                const updatedAt = Number(this.state.get().lastUpdateAt || 0);
                if (afterUpdateAt !== null && updatedAt <= Number(afterUpdateAt || 0)) return;
                finish(resolve, session);
            }));
            subscriptions.push(this.eventBus.on('connection:ended', event => {
                if (event.botId !== this.botId || normalizeConnectionGeneration(event) !== expected) return;
                finish(reject, new FlowError('Connection ended while waiting for GUI refresh.', {
                    code: 'GUI_WAIT_DISCONNECTED', subsystem: 'gui', operation: 'GuiManager', step: 'wait-refresh', retryable: true,
                    details: { expectedGeneration: expected }
                }));
            }));
            const timer = setTimeout(
                () => finish(reject, new Error(`GUI did not refresh: ${definitionId || 'any'}`)),
                timeoutMs
            );
            if (cancellationToken) {
                cancelUnsubscribe = cancellationToken.onCancelled(reason => finish(reject, new OperationCancelledError(String(reason || 'Cancelled'))));
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
        expectedGeneration = this.#currentGeneration(),
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
            expectedGeneration,
            label
        });

        try {
            const actionResult = await action();
            if (!this.#isExpectedCurrent(expectedGeneration)) throw new FlowError('GUI action generation changed.', {
                code: 'GUI_STALE_GENERATION', subsystem: 'gui', operation: 'GuiManager', step: 'open', retryable: true,
                details: { expectedGeneration, currentGeneration: this.#currentGeneration() }
            });
            if (actionResult?.success === false) {
                throw actionResult.error || new Error(actionResult.message || `${label} failed.`);
            }

            // Mineflayer may already expose the new currentWindow even when
            // windowOpen/gui:opened delivery was missed or delayed. Adopt it
            // synchronously after the action so correctness does not depend on
            // a polling interval winning a race against the timeout timer.
            const currentWindow = bot?.currentWindow || null;
            if (currentWindow && currentWindow !== beforeWindow) this.syncCurrentWindow();

            const session = await waiter.promise;
            if (source) { session.setSource(source); this.identify(session, { source, expectedId: source?.guiId || source?.definitionId || null }); }
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
            await Promise.allSettled([waiter.promise]);
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
        expectedGeneration = this.#currentGeneration(),
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
                expectedGeneration,
                label,
                source,
                settleMs
            });
        }

        const bot = this.context.get?.();
        const beforeWindow = before.window || bot?.currentWindow || null;
        const beforeRevision = Number(this.state.get().revision || 0);
        const waiter = this.#createTransitionWaiter({
            afterSessionId: before.id,
            afterRevision: beforeRevision,
            timeoutMs,
            cancellationToken,
            expectedGeneration,
            label
        });

        try {
            const actionResult = await action();
            if (!this.#isExpectedCurrent(expectedGeneration)) throw new FlowError('GUI transition generation changed.', {
                code: 'GUI_STALE_GENERATION', subsystem: 'gui', operation: 'GuiManager', step: 'transition', retryable: true,
                details: { expectedGeneration, currentGeneration: this.#currentGeneration() }
            });
            if (actionResult?.success === false) {
                throw actionResult.error || new Error(actionResult.message || `${label} failed.`);
            }

            // A transition can replace the current container before the
            // Mineflayer windowOpen/gui:opened bridge delivers its event.
            // Reconcile the already-visible new currentWindow immediately so
            // correctness does not depend on scheduler/poll timing. In-place
            // updates remain event-driven through the bound updateSlot path.
            const currentWindow = bot?.currentWindow || null;
            if (currentWindow && currentWindow !== beforeWindow) this.syncCurrentWindow();

            const session = await waiter.promise;
            if (source) { session.setSource(source); this.identify(session, { source, expectedId: source?.guiId || source?.definitionId || null }); }
            if (settleMs > 0) await this.#delay(settleMs, cancellationToken);
            return { session, actionResult };
        } catch (error) {
            waiter.cancel(error);
            await Promise.allSettled([waiter.promise]);
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
        expectedGeneration = this.#currentGeneration(),
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
            if (!this.#isExpectedCurrent(expectedGeneration)) throw new FlowError('GUI semantic wait generation changed.', {
                code: 'GUI_STALE_GENERATION', subsystem: 'gui', operation: 'GuiManager', step: 'wait-semantic-gui', retryable: true,
                details: { expectedGeneration, currentGeneration: this.#currentGeneration() }
            });
            try {
                if (attempt > 1 && closeBeforeRetry && this.current()) await this.closeCurrentWindow();
                const actionResult = await action({ attempt, maxAttempts });
                if (!this.#isExpectedCurrent(expectedGeneration)) throw new FlowError('GUI semantic action generation changed.', {
                    code: 'GUI_STALE_GENERATION', subsystem: 'gui', operation: 'GuiManager', step: 'wait-semantic-gui', retryable: true,
                    details: { expectedGeneration, currentGeneration: this.#currentGeneration() }
                });
                if (actionResult?.success === false) {
                    throw actionResult.error || new Error(actionResult.message || `${label} failed.`);
                }
                if (settleMs > 0) await this.#delay(settleMs, cancellationToken);
                const deadline = Date.now() + timeoutMs;
                while (Date.now() <= deadline) {
                    cancellationToken?.throwIfCancelled?.();
                    if (!this.#isExpectedCurrent(expectedGeneration)) throw new FlowError('GUI semantic polling generation changed.', {
                        code: 'GUI_STALE_GENERATION', subsystem: 'gui', operation: 'GuiManager', step: 'wait-semantic-gui', retryable: true,
                        details: { expectedGeneration, currentGeneration: this.#currentGeneration() }
                    });
                    const session = this.syncCurrentWindow();
                    if (session?.active && session.window) {
                        let accepted = false;
                        try { accepted = Boolean(await accept(session, { attempt, actionResult, before })); }
                        catch (predicateError) { lastReason = predicateError; }
                        if (accepted) {
                            if (source) { session.setSource(source); this.identify(session, { source, expectedId: source?.guiId || source?.definitionId || null }); }
                            return { session, actionResult, attempt };
                        }
                    }
                    await this.#delay(Math.max(10, Number(pollMs) || 50), cancellationToken);
                }
                lastReason = lastReason || new FlowError(`${label} did not expose an acceptable GUI.`, {
                    code: 'GUI_SEMANTIC_TIMEOUT', subsystem: 'gui', operation: 'GuiManager', step: 'wait-semantic-gui', retryable: true
                });
            } catch (error) {
                const terminalCodes = new Set([
                    'CANCELLED', 'DISCONNECTED', 'GUI_STALE_GENERATION', 'GUI_WAIT_DISCONNECTED',
                    'GUI_CLICK_DISCONNECTED', 'GUI_CLICK_STALE_GENERATION', 'COMMAND_STALE_GENERATION',
                    'TIMEOUT'
                ]);
                if (terminalCodes.has(error?.code)) {
                    throw FlowError.wrap(error, {
                        subsystem: 'gui', operation: 'GuiManager', step: 'wait-semantic-gui', action: label,
                        attempt, details: { before, after: this.describeCurrent(), attempts: maxAttempts }
                    });
                }
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
        expectedGeneration = this.#currentGeneration(),
        label = `slot ${slot}`,
        source = null,
        settleMs = 0,
        requireNewWindow = false,
        ...clickOptions
    } = {}) {
        const before = this.current();
        if (!before) throw new Error('No active GUI session.');
        const bot = this.context.get?.();
        const beforeWindow = before.window || bot?.currentWindow || null;
        const beforeRevision = Number(this.state.get().revision || 0);
        const waiter = requireNewWindow
            ? this.#createNextOpenWaiter({
                afterSessionId: before.id,
                beforeWindow: before.window,
                timeoutMs,
                cancellationToken,
                expectedGeneration,
                label
            })
            : this.#createTransitionWaiter({
                afterSessionId: before.id,
                afterRevision: beforeRevision,
                timeoutMs,
                cancellationToken,
                expectedGeneration,
                label
            });

        try {
            await this.click(slot, { timeoutMs, cancellationToken, expectedGeneration, ...clickOptions });

            // The click transport can resolve after Mineflayer has already
            // switched currentWindow while windowOpen/gui:opened delivery is
            // missed. Reconcile that observable replacement immediately;
            // in-place updates remain owned by the bound updateSlot path.
            const currentWindow = bot?.currentWindow || null;
            if (currentWindow && currentWindow !== beforeWindow) this.syncCurrentWindow();

            const session = await waiter.promise;
            if (source) { session.setSource(source); this.identify(session, { source, expectedId: source?.guiId || source?.definitionId || null }); }
            if (settleMs > 0) await this.#delay(settleMs, cancellationToken);
            return session;
        } catch (error) {
            waiter.cancel(error);
            await Promise.allSettled([waiter.promise]);
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

        const expectedGeneration = Number(options.expectedGeneration ?? session.connectionGeneration);
        const cancellationToken = options.cancellationToken || null;
        const capturedClient = session.client || this.context.get?.();
        const capturedWindow = session.window;
        return this.#measureClick(() => this.clickQueue.enqueue(async () => {
            cancellationToken?.throwIfCancelled?.();
            this.clickGuard.assert({ session, slot, expectedGeneration, capturedClient });
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
                verification = this.clickVerifier.arm({
                    botId: this.botId,
                    session,
                    timeoutMs: options.timeoutMs || 3000,
                    cancellationToken,
                    expectedGeneration
                });
            }
            try {
                // clickWindow's promise/transaction is the transport-level ACK.
                // Business success belongs to the caller: GUI transition,
                // inventory delta, /kho delta, teleport, etc.
                const data = await this.clickExecutor.click({
                    slot,
                    ...clickOptions,
                    cancellationToken,
                    expectedGeneration,
                    capturedClient,
                    capturedWindow
                });
                if (verification) {
                    // If Mineflayer already exposes a replacement container
                    // but the windowOpen/gui:opened bridge was missed, make
                    // that observable transition visible to the armed verifier
                    // before waiting on its event promise.
                    const currentWindow = capturedClient?.currentWindow || null;
                    if (this.#isExpectedCurrent(expectedGeneration, capturedClient)) {
                        if (currentWindow && currentWindow !== capturedWindow) {
                            this.syncCurrentWindow();
                        } else if (!currentWindow && capturedWindow && this.current()?.id === session.id) {
                            // Mineflayer also exposes a closed container as
                            // currentWindow=null. If windowClose/gui:closed was
                            // missed, reconcile the observable close so the
                            // verifier sees the same transition a normal event
                            // path would have produced.
                            this.close();
                        }
                    }
                    await verification.promise;
                }
                this.logger?.info?.('GUI CLICK OK', {
                    operation: 'GuiManager', step: 'click', phase: 'OK',
                    action: `click slot ${slot}`, resource: `slot:${slot}`,
                    slot, itemName: clickedItem?.name || null,
                    elapsedMs: Date.now() - startedAt
                });
                return data;
            } catch (error) {
                if (verification) {
                    verification.cancel(error);
                    await Promise.allSettled([verification.promise]);
                }
                throw FlowError.wrap(error, {
                    code: verifyGui ? 'GUI_CLICK_VERIFY_FAILED' : 'GUI_CLICK_FAILED',
                    subsystem: 'gui', operation: 'GuiManager', step: 'click',
                    action: `click slot ${slot}`, resource: `slot:${slot}`,
                    details: { slot, verifyGui, options: clickOptions, gui: this.describeCurrent() }
                });
            }
        }, {
            id: `click:${session.id}:${slot}:${Date.now()}`,
            cancellationToken,
            queueWaitTimeoutMs: Number.isFinite(options.queueWaitTimeoutMs) ? options.queueWaitTimeoutMs : null
        }));
    }

    #createNextOpenWaiter({ afterSessionId, beforeWindow = null, timeoutMs, cancellationToken, expectedGeneration = this.#currentGeneration(), label }) {
        const bot = this.context.get?.();
        const expected = Number(expectedGeneration);
        return this.#createEventWaiter({
            timeoutMs,
            cancellationToken,
            expectedGeneration: expected,
            timeoutMessage: `${label} did not open a GUI.`,
            subscribe: (finish, fail) => {
                const cleanups = [];

                const acceptWindow = window => {
                    if (!window) return;
                    if (!this.#isExpectedCurrent(expected, bot)) {
                        fail(new FlowError('GUI connection changed while waiting for window.', {
                            code: 'GUI_STALE_GENERATION', subsystem: 'gui', operation: 'GuiManager', step: 'wait-open', retryable: true,
                            details: { expectedGeneration: expected, currentGeneration: this.#currentGeneration() }
                        }));
                        return;
                    }

                    let session = this.current();
                    if (!session || session.window !== window) {
                        // Mineflayer already knows about the window but the
                        // GuiManager event path may have missed windowOpen.
                        // Action context is authoritative, so adopt it.
                        session = this.open(window, { client: bot, connectionGeneration: expected });
                    }

                    if (!session || Number(session.connectionGeneration) !== expected || session.client !== bot) return;
                    if (afterSessionId && session.id === afterSessionId) return;
                    finish(session);
                };

                cleanups.push(this.eventBus.on('gui:opened', event => {
                    if (event.botId !== this.botId) return;
                    if (normalizeConnectionGeneration(event) !== expected || !this.#isExpectedCurrent(expected, bot)) return;
                    if (afterSessionId && event.sessionId === afterSessionId) return;
                    const session = this.current();
                    if (!session || session.id !== event.sessionId || Number(session.connectionGeneration) !== expected || session.client !== bot) return;
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
                        if (!this.#isExpectedCurrent(expected, bot)) {
                            fail(new FlowError('GUI connection changed while polling window.', {
                                code: 'GUI_STALE_GENERATION', subsystem: 'gui', operation: 'GuiManager', step: 'wait-open', retryable: true,
                                details: { expectedGeneration: expected, currentGeneration: this.#currentGeneration() }
                            }));
                            return;
                        }
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

    #createTransitionWaiter({ afterSessionId, afterRevision, timeoutMs, cancellationToken, expectedGeneration = this.#currentGeneration(), label }) {
        const expected = Number(expectedGeneration);
        return this.#createEventWaiter({
            timeoutMs,
            cancellationToken,
            expectedGeneration: expected,
            timeoutMessage: `${label} did not produce a GUI transition.`,
            subscribe: finish => [
                this.eventBus.on('gui:opened', event => {
                    if (event.botId !== this.botId) return;
                    if (normalizeConnectionGeneration(event) !== expected || !this.#isExpectedCurrent(expected)) return;
                    if (event.sessionId === afterSessionId) return;
                    const session = this.current();
                    if (!session || session.id !== event.sessionId || Number(session.connectionGeneration) !== expected) return;
                    finish(session);
                }),
                this.eventBus.on('gui:updated', event => {
                    if (event.botId !== this.botId || event.sessionId !== afterSessionId) return;
                    if (normalizeConnectionGeneration(event) !== expected || !this.#isExpectedCurrent(expected)) return;
                    const revision = Number(this.state.get().revision || 0);
                    if (revision <= afterRevision) return;
                    const session = this.current();
                    if (!session || session.id !== afterSessionId || Number(session.connectionGeneration) !== expected) return;
                    finish(session);
                })
            ]
        });
    }

    #createEventWaiter({ timeoutMs, cancellationToken, expectedGeneration = null, timeoutMessage, subscribe }) {
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
            const fail = error => {
                if (settled) return;
                settled = true;
                cleanup();
                reject(error);
            };

            subscriptions = subscribe(finish, fail) || [];
            if (expectedGeneration !== null && expectedGeneration !== undefined) {
                subscriptions.push(this.eventBus.on('connection:ended', event => {
                    if (event.botId !== this.botId || normalizeConnectionGeneration(event) !== Number(expectedGeneration)) return;
                    fail(new FlowError('Connection ended while waiting for GUI event.', {
                        code: 'GUI_WAIT_DISCONNECTED', subsystem: 'gui', operation: 'GuiManager', step: 'wait-event', retryable: true,
                        details: { expectedGeneration }
                    }));
                }));
            }
            timer = setTimeout(() => {
                fail(new TimeoutError(timeoutMessage));
            }, timeoutMs);

            if (cancellationToken) {
                cancelUnsubscribe = cancellationToken.onCancelled(reason => {
                    fail(new OperationCancelledError(String(reason || 'Cancelled')));
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
                reject(new OperationCancelledError(String(reason || 'Cancelled')));
            });
        });
    }

    #measureClick(action) {
        return this.workloadMetrics ? this.workloadMetrics.measure('gui.click', action) : action();
    }

    #isSessionCurrent(session) {
        if (!session?.active) return false;
        const client = this.context.get?.() || null;
        if (session.client && client !== session.client) return false;
        return Number(session.connectionGeneration) === Number(this.context.getGeneration?.());
    }

    #currentGeneration() {
        const generation = Number(this.context.getGeneration?.());
        return Number.isInteger(generation) && generation > 0 ? generation : null;
    }

    #isExpectedCurrent(expectedGeneration, capturedClient = null) {
        const generation = this.#currentGeneration();
        const client = this.context.get?.() || null;
        if (generation === null || generation !== Number(expectedGeneration)) return false;
        return !capturedClient || client === capturedClient;
    }

    async stop() {
        this.windowBinding.stop();
        this.close();
        await this.clickQueue.destroy();
    }

    async destroy() {
        await this.stop();
    }
}

module.exports = GuiManager;
