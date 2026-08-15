'use strict';

const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const KhoSnapshot = require('./KhoSnapshot');
const FlowError = require('../../shared/errors/FlowError');

class KhoService {
    constructor({ commandService, guiManager, reader, sellOperation = null, config, guiKnowledge = null, logger = null }) {
        this.commandService = commandService;
        this.guiManager = guiManager;
        this.reader = reader;
        this.sellOperation = sellOperation;
        this.guiKnowledge = guiKnowledge;
        this.logger = logger;
        this.config = this.#validateConfig(config);
        this.lastKhoSessionId = null;
        this.source = Object.freeze({ commandKey: this.config.commandKey, command: '/kho', clicks: [], actions: [], source: 'operation' });
    }

    async read({ refresh = false, cancellationToken = null, preferData = false, maxAgeMs = Infinity, forceReopen = false } = {}) {
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
                if (this.#isReadableKhoSnapshot(snapshot, { trustedSource: this.#isKhoSource(current) })) {
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

            const session = await this.#openOrRefreshKho({ refresh, cancellationToken });
            this.lastKhoSessionId = session.id;
            await this.guiKnowledge?.observe(session, { source: this.source });
            const snapshot = this.reader.read(session.window);
            if (!this.#isReadableKhoSnapshot(snapshot)) {
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
                code: 'KHO_READ_FAILED', subsystem: 'storage', operation: 'KhoService',
                step: refresh ? 'refresh' : 'read', action: '/kho', resource: 'storage',
                details: { refresh, preferData, maxAgeMs, forceReopen, gui: this.guiManager.describeCurrent?.() || null }
            });
            return Result.fail(Status.NOT_FOUND, wrapped.message, wrapped, wrapped.toDiagnostic());
        }
    }

    latest({ maxAgeMs = Infinity } = {}) {
        const data = this.guiKnowledge?.getSemantic(this.source, 'storage', { maxAgeMs });
        if (!data) return Result.fail(Status.NOT_FOUND, 'No current /kho GUI data is available.');
        return Result.ok(new KhoSnapshot(data));
    }

    async sell(logicalId, { quantity = 64, cancellationToken = null } = {}) {
        if (!this.sellOperation) return Result.fail(Status.FAILED, 'Storage sell operation is unavailable.');
        try {
            const action = await this.sellOperation.execute(logicalId, { quantity, cancellationToken });
            return Result.ok(action);
        } catch (error) {
            const wrapped = FlowError.wrap(error, {
                code: 'KHO_SELL_FAILED', subsystem: 'storage', operation: 'KhoService',
                step: 'sell', action: '/kho sell GUI', resource: logicalId,
                details: { logicalId, quantity, gui: this.guiManager.describeCurrent?.() || null }
            });
            return Result.fail(Status.FAILED, wrapped.message, wrapped, wrapped.toDiagnostic());
        }
    }

    async closeSellGui() {
        try {
            await this.sellOperation?.close?.();
            return Result.ok({ closed: true });
        } catch (error) {
            return Result.fail(Status.FAILED, error.message, error);
        }
    }

    // Compatibility shim for old callers. Production B1 must not use SELL ALL;
    // route this through the guarded GUI action only when explicitly allowed.
    async sellAll(logicalId, { cancellationToken = null } = {}) {
        return this.sell(logicalId, { quantity: 'ALL', cancellationToken });
    }

    invalidateSnapshot() {
        this.lastKhoSessionId = null;
        this.guiKnowledge?.invalidateSemantic(this.source, 'storage').catch?.(() => {});
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

    async #openOrRefreshKho({ refresh, cancellationToken }) {
        const errors = [];

        for (let attempt = 1; attempt <= this.config.openAttempts; attempt += 1) {
            try {
                this.logger?.info?.('KHO OPEN ATTEMPT', {
                    operation: 'KhoService', step: 'open-or-refresh', phase: 'START',
                    action: '/kho', resource: 'storage', attempt, maxAttempts: this.config.openAttempts
                });
                return await this.#attemptKhoCommand({ refresh, cancellationToken });
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
    async #attemptKhoCommand({ refresh, cancellationToken }) {
        cancellationToken?.throwIfCancelled?.();

        let beforeSession = this.guiManager.syncCurrentWindow?.() || this.guiManager.current();
        let beforeWindow = beforeSession?.window || null;
        let beforeSnapshot = beforeWindow ? this.reader.read(beforeWindow) : null;
        let beforeWasReadableKho = this.#isReadableKhoSnapshot(beforeSnapshot, { trustedSource: this.#isKhoSource(beforeSession) });

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
            beforeWasReadableKho = this.#isReadableKhoSnapshot(beforeSnapshot, { trustedSource: this.#isKhoSource(beforeSession) });
        }

        this.logger?.info?.('KHO COMMAND SEND', {
            operation: 'KhoService', step: refresh ? 'refresh-command' : 'open-command', phase: 'START',
            action: '/kho', resource: 'storage'
        });
        const actionResult = await this.commandService.send(this.config.commandKey, {
            confirm: false,
            cancellationToken
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
                const readable = this.#isReadableKhoSnapshot(snapshot, { trustedSource: true });

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

        // Capacity is the strongest semantic invariant and is enough even when
        // the source tag was lost during an in-place server refresh.
        if (this.#hasCapacity(snapshot.capacity)) return true;

        // Do NOT classify an arbitrary /ks, /nung or crafting GUI as /kho just
        // because KhoReader can resolve a coal/iron/etc. item inside it. The
        // item-only fallback is valid only after the session has already been
        // proven to come from the /kho command.
        return trustedSource && Object.keys(snapshot.items || {}).length > 0;
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
