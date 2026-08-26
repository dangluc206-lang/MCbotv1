'use strict';

const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const KhoSnapshot = require('./KhoSnapshot');
const FlowError = require('../../shared/errors/FlowError');
const Operation = require('../../operations/Operation');

class KhoService {
    constructor({ commandService, guiManager, reader, sellOperation = null, config, guiKnowledge = null, operationManager = null, context = null, logger = null }) {
        this.commandService = commandService;
        this.guiManager = guiManager;
        this.reader = reader;
        this.sellOperation = sellOperation;
        this.guiKnowledge = guiKnowledge;
        this.operationManager = operationManager;
        this.context = context;
        this.logger = logger;
        this.config = this.#validateConfig(config);
        this.lastKhoSessionId = null;
        this.source = Object.freeze({ commandKey: this.config.commandKey, command: '/kho', guiId: this.config.guiId, clicks: [], actions: [], source: 'operation' });
    }

    reconfigure(config) {
        const next = this.#validateConfig(config);
        this.config = next;
        this.reader?.reconfigure?.(next);
        this.sellOperation?.reconfigure?.(next);
        this.source = Object.freeze({ commandKey: next.commandKey, command: '/kho', guiId: next.guiId, clicks: [], actions: [], source: 'operation' });
        this.lastKhoSessionId = null;
        return this;
    }

    async read(options = {}) {
        let { refresh = false, cancellationToken = null, preferData = false, maxAgeMs = Infinity, forceReopen = false, operationContext = null } = options;
        if (this.operationManager && !operationContext) {
            return this.#runManaged('KhoService.read', ['gui', 'storage'], options,
                context => this.read({ ...options, operationContext: context, cancellationToken: context.cancellation.token, expectedGeneration: context.connectionGeneration }),
                { refresh, forceReopen });
        }
        const expectedGeneration = this.#expectedGeneration(options);
        this.#assertGeneration(expectedGeneration);
        const startedAt = Date.now();
        this.logger?.info?.('KHO READ START', {
            operation: 'KhoService', step: refresh ? 'refresh' : 'read', phase: 'START',
            action: '/kho', resource: 'storage', refresh
        });
        try {
            if (forceReopen) {
                this.lastKhoSessionId = null;
                await this.guiKnowledge?.invalidateSemantic?.(this.source, 'storage');
                if (this.guiManager.current()) {
                    await this.#closeAndSettleBeforeKho(cancellationToken);
                }
                refresh = true;
                this.logger?.info?.('KHO FORCE REOPEN', {
                    operation: 'KhoService', step: 'force-reopen', phase: 'START',
                    action: 'close current GUI and reopen /kho', resource: 'storage'
                });
            }
            if (preferData && !refresh) {
                const cached = this.latest({ maxAgeMs });
                if (cached.success) {
                    this.logger?.info?.('KHO READ CACHE', {
                        operation: 'KhoService', step: 'read-cache', phase: 'OK',
                        action: 'use cached /kho snapshot', resource: 'storage',
                        elapsedMs: Date.now() - startedAt
                    });
                    return cached;
                }
            }

            const current = this.guiManager.current();
            if (!refresh && current?.active && current.id === this.lastKhoSessionId) {
                const snapshot = this.reader.read(current.window);
                if (this.#isVerifiedKhoSession(current, snapshot, { commandContext: false })) {
                    await this.#remember(snapshot);
                    this.logger?.info?.('KHO READ OK', {
                        operation: 'KhoService', step: 'read-current', phase: 'OK',
                        action: 'parse current /kho GUI', resource: 'storage',
                        count: Object.keys(snapshot?.items || {}).length,
                        used: snapshot?.capacity?.used ?? null,
                        free: snapshot?.capacity?.free ?? null,
                        elapsedMs: Date.now() - startedAt
                    });
                    return Result.ok(snapshot);
                }
                // The session we remembered is no longer a readable /kho
                // window. Do not keep trusting its id forever.
                this.lastKhoSessionId = null;
            }

            const session = await this.#openOrRefreshKho({ refresh, cancellationToken, expectedGeneration, operationContext });
            this.#assertGeneration(expectedGeneration);
            this.lastKhoSessionId = session.id;
            await this.guiKnowledge?.observe(session, { source: this.source });
            const snapshot = this.reader.read(session.window);
            if (!this.#isReadableKhoSnapshot(snapshot, { trustedSource: true })) {
                throw new Error('/kho GUI opened but storage data was not readable.');
            }
            await this.#remember(snapshot);
            this.logger?.info?.('KHO READ OK', {
                operation: 'KhoService', step: refresh ? 'refresh' : 'read', phase: 'OK',
                action: '/kho', resource: 'storage',
                count: Object.keys(snapshot?.items || {}).length,
                used: snapshot?.capacity?.used ?? null,
                free: snapshot?.capacity?.free ?? null,
                elapsedMs: Date.now() - startedAt
            });
            return Result.ok(snapshot);
        } catch (error) {
            const wrapped = FlowError.wrap(error, {
                code: error?.code || 'KHO_READ_FAILED', subsystem: 'storage', operation: 'KhoService',
                step: refresh ? 'refresh' : 'read', action: '/kho', resource: 'storage',
                details: { refresh, preferData, maxAgeMs, forceReopen, gui: this.guiManager.describeCurrent?.() || null }
            });
            const status = Operation.statusForError(error);
            return Result.fail(status === Status.FAILED ? Status.NOT_FOUND : status, wrapped.message, wrapped, wrapped.toDiagnostic());
        }
    }

    latest({ maxAgeMs = Infinity } = {}) {
        const data = this.guiKnowledge?.getSemantic(this.source, 'storage', { maxAgeMs });
        if (!data) return Result.fail(Status.NOT_FOUND, 'No current /kho GUI data is available.');
        return Result.ok(new KhoSnapshot(data));
    }

    async sell(logicalId, options = {}) {
        const { quantity = 64, cancellationToken = null, operationContext = null } = options;
        if (this.operationManager && !operationContext) {
            return this.#runManaged('KhoService.sell', ['gui', 'storage'], options,
                context => this.sell(logicalId, { ...options, operationContext: context, cancellationToken: context.cancellation.token, expectedGeneration: context.connectionGeneration }),
                { logicalId, quantity });
        }
        if (!this.sellOperation) return Result.fail(Status.FAILED, 'Storage sell operation is unavailable.');
        try {
            const expectedGeneration = this.#expectedGeneration(options);
            this.#assertGeneration(expectedGeneration);
            const action = await this.sellOperation.execute(logicalId, { ...options, quantity, cancellationToken, expectedGeneration, operationContext });
            this.#assertGeneration(expectedGeneration);
            return Result.ok(action);
        } catch (error) {
            const wrapped = FlowError.wrap(error, {
                code: error?.code || 'KHO_SELL_FAILED', subsystem: 'storage', operation: 'KhoService',
                step: 'sell', action: '/kho sell GUI', resource: logicalId,
                details: { logicalId, quantity, gui: this.guiManager.describeCurrent?.() || null }
            });
            return Result.fail(Operation.statusForError(error), wrapped.message, wrapped, wrapped.toDiagnostic());
        }
    }

    async closeSellGui(options = {}) {
        if (this.operationManager && !options.operationContext) {
            return this.#runManaged('KhoService.closeSellGui', ['gui', 'storage'], options,
                context => this.closeSellGui({ ...options, operationContext: context, cancellationToken: context.cancellation.token, expectedGeneration: context.connectionGeneration }));
        }
        try {
            await this.sellOperation?.close?.();
            return Result.ok({ closed: true });
        } catch (error) {
            return Result.fail(Operation.statusForError(error), error.message, error);
        }
    }

    // Compatibility shim for old callers. Production keeps allowAll=false;
    // when explicitly enabled, the executor applies it as a global Sell policy.
    async sellAll(logicalId, options = {}) {
        return this.sell(logicalId, { ...options, quantity: 'ALL' });
    }

    invalidateSnapshot() {
        this.lastKhoSessionId = null;
        const pending = this.guiKnowledge?.invalidateSemantic(this.source, 'storage');
        if (pending?.catch) {
            void pending.catch(error => this.logger?.debug?.('Storage semantic invalidation failed.', { error }));
        }
    }

    async #remember(snapshot) {
        if (!this.guiKnowledge) return;
        await this.guiKnowledge.setSemantic(this.source, 'storage', {
            items: snapshot.items,
            capacity: snapshot.capacity,
            sources: snapshot.sources,
            capturedAt: snapshot.capturedAt
        });
    }

    async #openOrRefreshKho({ refresh, cancellationToken, expectedGeneration = null, operationContext = null }) {
        const errors = [];

        for (let attempt = 1; attempt <= this.config.openAttempts; attempt += 1) {
            try {
                this.logger?.info?.('KHO OPEN ATTEMPT', {
                    operation: 'KhoService', step: 'open-or-refresh', phase: 'START',
                    action: '/kho', resource: 'storage', attempt, maxAttempts: this.config.openAttempts
                });
                return await this.#attemptKhoCommand({ refresh, cancellationToken, expectedGeneration, operationContext });
            } catch (error) {
                errors.push(error);
                if (attempt >= this.config.openAttempts) break;

                this.logger?.debug?.('A /kho command did not expose readable storage data; retrying.', {
                    attempt,
                    maxAttempts: this.config.openAttempts,
                    error: error.message
                });

                // First attempt is deliberately command-only. Only fall back
                // to a close when the current GUI cannot be parsed as /kho.
                if (this.guiManager.current()) {
                    await this.#closeAndSettleBeforeKho(cancellationToken);
                } else {
                    await this.#delay(this.config.retryDelayMs, cancellationToken);
                }
            }
        }

        const first = errors[0]?.message || 'unknown';
        const last = errors.at(-1)?.message || 'unknown';
        throw new FlowError(
            `/kho did not expose readable storage data after ${this.config.openAttempts} attempts. First: ${first}; Last: ${last}`,
            {
                code: 'KHO_GUI_NOT_READABLE', subsystem: 'storage', operation: 'KhoService',
                step: 'open-or-refresh', action: '/kho', resource: 'storage', attempt: this.config.openAttempts,
                details: { attempts: errors.map((error, index) => ({ attempt: index + 1, message: error.message })), gui: this.guiManager.describeCurrent?.() || null },
                cause: errors.at(-1) || null
            }
        );
    }

    /**
     * /kho is command-driven: if the command succeeds, the resulting/current
     * container is the /kho candidate. We do not require a new window id or an
     * updateSlot event. Instead we poll Mineflayer's currentWindow and accept
     * the candidate once the real storage payload is readable (slot 49
     * capacity and/or parsed storage values).
     */
    async #attemptKhoCommand({ refresh, cancellationToken, expectedGeneration = null, operationContext = null }) {
        cancellationToken?.throwIfCancelled?.();
        this.#assertGeneration(expectedGeneration);

        let beforeSession = this.guiManager.syncCurrentWindow?.() || this.guiManager.current();
        let beforeWindow = beforeSession?.window || null;
        let beforeSnapshot = beforeWindow ? this.reader.read(beforeWindow) : null;
        let beforeWasReadableKho = this.#isVerifiedKhoSession(beforeSession, beforeSnapshot, { commandContext: false });

        // Commands on this server can be ignored while an unrelated inventory
        // GUI is still open. Close /ks, /nung, crafting, etc. before /kho
        // instead of wasting the first full GUI timeout on a command that the
        // server never processes. A readable /kho may still be refreshed in-place.
        const beforeWasSellGui = beforeSession?.source?.commandKey === this.config?.sell?.commandKey
            || beforeSession?.source?.command === '/kho sell';
        if (beforeSession?.active && (beforeWasSellGui || !beforeWasReadableKho)) {
            this.logger?.debug?.(beforeWasSellGui
                ? 'Closing /kho sell GUI before /kho command.'
                : 'Closing unrelated GUI before /kho command.', {
                operation: 'KhoService', step: 'prepare-open', action: 'close current GUI before /kho',
                gui: this.guiManager.describeCurrent?.() || null
            });
            await this.#closeAndSettleBeforeKho(cancellationToken);
            beforeSession = this.guiManager.syncCurrentWindow?.() || this.guiManager.current();
            beforeWindow = beforeSession?.window || null;
            beforeSnapshot = beforeWindow ? this.reader.read(beforeWindow) : null;
            beforeWasReadableKho = this.#isVerifiedKhoSession(beforeSession, beforeSnapshot, { commandContext: false });
        }

        if (!beforeSession?.active && typeof this.guiManager.waitForPostCloseSettle === 'function') {
            const waitedMs = await this.guiManager.waitForPostCloseSettle(this.config.openAfterCloseSettleMs, { cancellationToken });
            if (waitedMs > 0) this.logger?.debug?.('KHO POST-CLOSE COMMAND GATE', {
                operation: 'KhoService', step: 'prepare-open', action: 'wait after GUI close before /kho', resource: 'storage', waitedMs
            });
        }

        this.logger?.info?.('KHO COMMAND SEND', {
            operation: 'KhoService', step: refresh ? 'refresh-command' : 'open-command', phase: 'START',
            action: '/kho', resource: 'storage'
        });
        const actionResult = await this.commandService.send(this.config.commandKey, {
            confirm: false,
            cancellationToken,
            expectedGeneration,
            operationId: operationContext?.operationId || null,
            correlationId: operationContext?.correlationId || null
        });
        if (actionResult?.success === false) {
            throw actionResult.error || new Error(actionResult.message || '/kho command failed.');
        }

        this.logger?.info?.('KHO COMMAND SENT', {
            operation: 'KhoService', step: refresh ? 'refresh-command' : 'open-command', phase: 'OK',
            action: '/kho', resource: 'storage'
        });
        const settleMs = refresh ? this.config.refreshSettleMs : this.config.openSettleMs;
        if (settleMs > 0) await this.#delay(settleMs, cancellationToken);
        this.#assertGeneration(expectedGeneration);

        const deadline = Date.now() + this.config.guiTimeoutMs;
        let lastState = {
            hasSession: false,
            itemCount: 0,
            hasCapacity: false,
            changedWindow: false,
            beforeWasReadableKho
        };

        while (Date.now() <= deadline) {
            cancellationToken?.throwIfCancelled?.();
            this.#assertGeneration(expectedGeneration);

            // Reconcile against Mineflayer directly so a missed windowOpen or
            // in-place server refresh cannot make /kho look like it failed.
            const session = this.guiManager.syncCurrentWindow?.() || this.guiManager.current();
            if (session?.active && session.window) {
                const snapshot = this.reader.read(session.window);
                const itemCount = Object.keys(snapshot?.items || {}).length;
                const hasCapacity = this.#hasCapacity(snapshot?.capacity);
                const changedWindow = !beforeWindow
                    || session.window !== beforeWindow
                    || (beforeSession && session.id !== beforeSession.id);
                const readable = this.#isVerifiedKhoSession(session, snapshot, { commandContext: true });

                lastState = {
                    hasSession: true,
                    itemCount,
                    hasCapacity,
                    changedWindow,
                    beforeWasReadableKho
                };

                // Command context identifies the GUI. A readable storage
                // payload is enough when either a new window appeared or the
                // previous window was already a readable /kho and was merely
                // refreshed in-place. If the previous GUI was unrelated, do
                // not accept that exact unchanged window just because it has
                // coincidental item data.
                if (readable && (changedWindow || beforeWasReadableKho || !beforeSession)) {
                    session.setSource?.(this.source);
                    this.logger?.info?.('KHO GUI VERIFIED', {
                        operation: 'KhoService', step: refresh ? 'refresh-wait' : 'open-wait', phase: 'OK',
                        action: '/kho', resource: 'storage',
                        count: itemCount, hasCapacity, changedWindow
                    });
                    return session;
                }
            }

            await this.#delay(this.config.commandPollMs, cancellationToken);
        }

        throw new FlowError('/kho command was sent but current GUI did not contain readable storage data.', {
            code: 'KHO_SEMANTIC_VERIFY_TIMEOUT', subsystem: 'storage', operation: 'KhoService',
            step: refresh ? 'refresh-wait' : 'open-wait', action: '/kho', resource: 'storage',
            details: { ...lastState, timeoutMs: this.config.guiTimeoutMs, gui: this.guiManager.describeCurrent?.() || null }
        });
    }


    async #closeAndSettleBeforeKho(cancellationToken = null) {
        if (this.guiManager.current()) await this.guiManager.closeCurrentWindow();

        // Mineflayer local state can clear before the server accepts another
        // inventory command. Confirm that no window remains, then give the
        // server a dedicated post-close settle interval before sending /kho.
        const deadline = Date.now() + this.config.closeConfirmTimeoutMs;
        while (Date.now() <= deadline) {
            cancellationToken?.throwIfCancelled?.();
            const current = this.guiManager.syncCurrentWindow?.() || this.guiManager.current();
            if (!current?.active) break;
            await this.#delay(this.config.commandPollMs, cancellationToken);
        }
        const remaining = this.guiManager.syncCurrentWindow?.() || this.guiManager.current();
        if (remaining?.active) {
            throw new Error('Current GUI did not close before /kho command.');
        }
        await this.#delay(this.config.openAfterCloseSettleMs, cancellationToken);
    }

    #isReadableKhoSnapshot(snapshot, { trustedSource = false } = {}) {
        if (!snapshot || typeof snapshot !== 'object') return false;

        const itemCount = Object.keys(snapshot.items || {}).length;
        const capacity = snapshot.capacity || null;
        const hasCapacity = this.#hasCapacity(capacity);
        const derivedCapacity = capacity?.derivedFromItems === true;

        // A capacity snapshot parsed from the real capacity indicator is the
        // strongest semantic invariant and can identify /kho even when the
        // source tag was lost during an in-place server refresh.
        if (hasCapacity && !derivedCapacity) return true;

        // KhoReader may synthesize the 800,000 capacity fallback from parsed
        // item totals when the capacity indicator is unavailable. That fallback
        // must NEVER identify an arbitrary GUI by itself. In particular /pv 2
        // can produce { used: 0, free: 800000, derivedFromItems: true }, which
        // previously made B5 treat the vault as an empty /kho and conclude all
        // B1 was missing. Accept derived/item-only telemetry only after command
        // context has already proven this session belongs to /kho, and require
        // at least one parsed storage item so an empty unrelated GUI cannot pass.
        if (trustedSource && itemCount > 0) return true;

        return false;
    }

    #isVerifiedKhoSession(session, snapshot, { commandContext = false } = {}) {
        const trustedSource = this.#isKhoSource(session) || commandContext;
        if (!this.#isReadableKhoSnapshot(snapshot, { trustedSource })) return false;

        // Identity V2 combines title/layout/fingerprints with command context and
        // semantic storage evidence. Keep the payload validator above as a
        // separate guard so command context alone can never turn an unchanged
        // unrelated GUI into /kho.
        if (typeof this.guiManager?.identify === 'function') {
            const capacity = snapshot?.capacity || null;
            const itemCount = Object.keys(snapshot?.items || {}).length;
            const semanticEvidence = [];
            if (this.#hasCapacity(capacity) && capacity?.derivedFromItems !== true) {
                semanticEvidence.push({
                    candidateId: this.config.guiId, signal: 'storage-capacity-indicator', matched: true, weight: 0.42,
                    details: { used: capacity.used ?? null, free: capacity.free ?? null, limit: capacity.limit ?? capacity.total ?? null }
                });
            } else if (itemCount > 0 && trustedSource) {
                semanticEvidence.push({
                    candidateId: this.config.guiId, signal: 'storage-item-payload', matched: true, weight: 0.20,
                    details: { itemCount, derivedCapacity: capacity?.derivedFromItems === true }
                });
            }
            const source = commandContext ? this.source : (session?.source || null);
            const expectedId = commandContext || this.#isKhoSource(session) ? this.config.guiId : null;
            const identity = this.guiManager.identify(session, { expectedId, source, semanticEvidence });
            return Boolean(identity?.id === this.config.guiId && Number(identity?.confidence || 0) >= 0.58);
        }

        return true;
    }

    #isKhoSource(session) {
        const source = session?.source || null;
        return source?.commandKey === this.config.commandKey || source?.command === '/kho';
    }

    #hasCapacity(capacity) {
        if (!capacity || typeof capacity !== 'object') return false;
        return ['used', 'free', 'limit', 'total'].some(key => Number.isFinite(Number(capacity[key])));
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

    #expectedGeneration(options = {}) {
        const candidate = options.expectedGeneration ?? options.operationContext?.connectionGeneration ?? this.context?.getGeneration?.() ?? null;
        if (candidate === null || candidate === undefined) return null;
        const generation = Number(candidate);
        return Number.isInteger(generation) && generation > 0 ? generation : null;
    }

    #assertGeneration(expectedGeneration) {
        if (expectedGeneration === null || !this.context) return;
        if (this.context.has?.() && Number(this.context.getGeneration?.()) === expectedGeneration) return;
        throw new FlowError('Storage operation belongs to a stale connection generation.', {
            code: 'DISCONNECTED', subsystem: 'storage', operation: 'KhoService', step: 'generation-guard', retryable: true,
            details: { expectedGeneration, currentGeneration: this.context.getGeneration?.() ?? null }
        });
    }

    #runManaged(name, lockKeys, options, action, metadata = null) {
        const operation = new Operation({ name, lockKeys, returnsResult: true, execute: action });
        return this.operationManager.run(operation, {
            operationContext: options.operationContext || null,
            cancellationToken: options.cancellationToken || null,
            connectionGeneration: this.#expectedGeneration(options),
            timeoutMs: options.timeoutMs,
            queueWaitTimeoutMs: options.queueWaitTimeoutMs,
            correlationId: options.correlationId || null,
            metadata: { subsystem: 'storage', ...(metadata || {}) }
        });
    }

    #validateConfig(config) {
        if (!config || typeof config !== 'object') throw new TypeError('storage config is required');
        if (typeof config.commandKey !== 'string' || !config.commandKey) throw new Error('storage.commandKey is required');
        if (!Number.isFinite(config.guiTimeoutMs) || config.guiTimeoutMs <= 0) throw new Error('storage.guiTimeoutMs must be positive');
        const openAttempts = config.openAttempts === undefined ? 2 : Number(config.openAttempts);
        if (!Number.isSafeInteger(openAttempts) || openAttempts < 1 || openAttempts > 3) {
            throw new Error('storage.openAttempts must be an integer from 1 to 3');
        }
        return {
            ...config,
            openAttempts,
            openSettleMs: Number.isFinite(config.openSettleMs) && config.openSettleMs >= 0
                ? config.openSettleMs
                : 200,
            refreshSettleMs: Number.isFinite(config.refreshSettleMs) && config.refreshSettleMs >= 0
                ? config.refreshSettleMs
                : 150,
            commandPollMs: Number.isFinite(config.commandPollMs) && config.commandPollMs >= 10
                ? config.commandPollMs
                : 50,
            retryDelayMs: Number.isFinite(config.retryDelayMs) && config.retryDelayMs >= 0
                ? config.retryDelayMs
                : 500,
            retryCloseSettleMs: Number.isFinite(config.retryCloseSettleMs) && config.retryCloseSettleMs >= 0
                ? config.retryCloseSettleMs
                : 350,
            openAfterCloseSettleMs: Number.isFinite(config.openAfterCloseSettleMs) && config.openAfterCloseSettleMs >= 0
                ? config.openAfterCloseSettleMs
                : 1000,
            closeConfirmTimeoutMs: Number.isFinite(config.closeConfirmTimeoutMs) && config.closeConfirmTimeoutMs >= 0
                ? config.closeConfirmTimeoutMs
                : 1000
        };
    }
}

module.exports = KhoService;
