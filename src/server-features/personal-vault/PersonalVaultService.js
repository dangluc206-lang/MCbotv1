'use strict';

const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const Timeout = require('../../shared/time/Timeout');
const FlowError = require('../../shared/errors/FlowError');
const PersonalVaultSnapshot = require('./PersonalVaultSnapshot');
const Operation = require('../../operations/Operation');

class PersonalVaultService {
    constructor({ commandService, guiManager, reader, transfer, config, guiKnowledge = null, inventoryReader = null, inventoryCounter = null, operationManager = null, context = null, logger = null }) {
        this.commandService = commandService;
        this.guiManager = guiManager;
        this.reader = reader;
        this.transfer = transfer;
        this.guiKnowledge = guiKnowledge;
        this.inventoryReader = inventoryReader;
        this.inventoryCounter = inventoryCounter;
        this.operationManager = operationManager;
        this.context = context;
        this.logger = logger;
        this.config = this.#validateConfig(config);
        this.source = Object.freeze({ commandKey: this.config.commandKey, command: '/pv 2', guiId: this.config.guiId, clicks: [], actions: [], source: 'operation' });
    }

    async open(options = {}) {
        const { cancellationToken = null, operationContext = null } = options;
        if (this.operationManager && !operationContext) {
            return this.#runManaged('PersonalVaultService.open', ['gui', 'personal-vault'], options,
                context => this.open({ ...options, operationContext: context, cancellationToken: context.cancellation.token, expectedGeneration: context.connectionGeneration }));
        }
        const expectedGeneration = this.#expectedGeneration(options);
        this.#assertGeneration(expectedGeneration);
        const attempts = this.config.openAttempts;
        this.logger?.info?.('PV OPEN START', {
            operation: 'PersonalVaultService', step: 'open', phase: 'START',
            action: '/pv 2', resource: 'personalVault2'
        });

        // Reuse the vault session that this service already proved/opened.
        // Re-sending /pv 2 while the same vault GUI is open is ignored by this
        // server, so performAndWaitForOpen() would otherwise wait the full GUI
        // timeout for a window that can never appear.
        const current = this.guiManager.syncCurrentWindow?.() || this.guiManager.current?.();
        if (this.#isCurrentVaultSession(current)) {
            await this.guiKnowledge?.observe(current, { source: this.source });
            this.logger?.info?.('PV OPEN REUSE', {
                operation: 'PersonalVaultService', step: 'open-reuse', phase: 'OK',
                action: 'reuse current /pv 2', resource: 'personalVault2',
                windowId: current?.window?.id ?? current?.id ?? null,
                title: current?.window?.title || null
            });
            return Result.ok(current, { attempt: 0, reused: true });
        }

        let lastError = null;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                await this.#closeForeignGuiAndSettle(cancellationToken);
                if (typeof this.guiManager.waitForPostCloseSettle === 'function') {
                    await this.guiManager.waitForPostCloseSettle(this.config.openAfterCloseSettleMs, { cancellationToken });
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
                        label: '/pv 2',
                        settleMs: this.config.openSettleMs,
                        source: this.source
                    }
                );
                const identity = typeof this.guiManager?.identify === 'function'
                    ? this.guiManager.identify(session, { expectedId: this.config.guiId, source: this.source })
                    : null;
                if (identity && (identity.id !== this.config.guiId || Number(identity.confidence || 0) < 0.58)) {
                    throw new FlowError('/pv 2 opened a GUI whose identity could not be verified.', {
                        code: 'PV_GUI_IDENTITY_MISMATCH', subsystem: 'personal-vault', operation: 'PersonalVaultService',
                        step: 'open-identity', action: '/pv 2', resource: 'personalVault2', retryable: true,
                        details: { expectedGuiId: this.config.guiId, identity }
                    });
                }
                await this.guiKnowledge?.observe(session, { source: this.source });
                this.#assertGeneration(expectedGeneration);
                this.logger?.info?.('PV OPEN OK', {
                    operation: 'PersonalVaultService', step: 'open', phase: 'OK',
                    action: '/pv 2', resource: 'personalVault2', attempt,
                    title: session?.window?.title || null
                });
                return Result.ok(session, { attempt });
            } catch (error) {
                lastError = error;
                if (['CANCELLED', 'DISCONNECTED', 'GUI_WAIT_DISCONNECTED', 'GUI_STALE_GENERATION'].includes(error?.code)) break;
                if (attempt >= attempts) break;
                if (this.guiManager.current()) await this.guiManager.closeCurrentWindow();
                if (this.config.openRetryMs > 0) await Timeout.delay(this.config.openRetryMs, { cancellationToken });
            }
        }
        const sourceError = lastError || new Error('/pv 2 did not open a GUI.');
        const openStatus = Operation.statusForError(sourceError);
        const wrapped = FlowError.wrap(sourceError, {
            code: sourceError?.code || 'PV_GUI_OPEN_FAILED', subsystem: 'personal-vault', operation: 'PersonalVaultService',
            step: 'open', action: '/pv 2', resource: 'personalVault2', attempt: attempts,
            details: { gui: this.guiManager.describeCurrent(), attempts }
        });
        return Result.fail(openStatus === Status.FAILED ? Status.NOT_FOUND : openStatus, wrapped.message, wrapped, wrapped.toDiagnostic());
    }

    async read(options = {}) {
        const { preferData = false, maxAgeMs = Infinity, cancellationToken = null, operationContext = null } = options;
        if (this.operationManager && !operationContext) {
            return this.#runManaged('PersonalVaultService.read', ['gui', 'personal-vault'], options,
                context => this.read({ ...options, operationContext: context, cancellationToken: context.cancellation.token, expectedGeneration: context.connectionGeneration }));
        }
        const startedAt = Date.now();
        this.logger?.info?.('PV READ START', {
            operation: 'PersonalVaultService', step: 'read', phase: 'START',
            action: 'read /pv 2', resource: 'personalVault2'
        });
        if (preferData) {
            const cached = this.latest({ maxAgeMs });
            if (cached.success) return cached;
        }
        const opened = await this.open({ ...options, cancellationToken, operationContext });
        if (!opened.success) return opened;
        try {
            const snapshot = typeof this.reader.readAndLearn === 'function'
                ? await this.reader.readAndLearn(opened.data.window, { source: 'personal-vault-read' })
                : this.reader.read(opened.data.window);
            await this.#remember(snapshot);
            this.logger?.info?.('PV READ OK', {
                operation: 'PersonalVaultService', step: 'read', phase: 'OK',
                action: 'read /pv 2', resource: 'personalVault2',
                count: snapshot?.items?.length || 0,
                elapsedMs: Date.now() - startedAt
            });
            return Result.ok(snapshot);
        } catch (error) {
            const wrapped = FlowError.wrap(error, {
                code: error?.code || 'PV_PARSE_FAILED', subsystem: 'personal-vault', operation: 'PersonalVaultService',
                step: 'read', action: 'parse /pv 2', resource: 'personalVault2',
                details: { gui: this.guiManager.describeCurrent() }
            });
            return Result.fail(Operation.statusForError(error), wrapped.message, wrapped, wrapped.toDiagnostic());
        }
    }

    latest({ maxAgeMs = Infinity } = {}) {
        const data = this.guiKnowledge?.getSemantic(this.source, 'personalVault', { maxAgeMs });
        if (!data) return Result.fail(Status.NOT_FOUND, 'No current /pv 2 GUI data is available.');
        return Result.ok(new PersonalVaultSnapshot(data));
    }

    async withdraw(logicalId, options = {}) {
        if (this.operationManager && !options.operationContext) {
            return this.#runManaged('PersonalVaultService.withdraw', ['gui', 'inventory', 'personal-vault'], options,
                context => this.withdraw(logicalId, { ...options, operationContext: context, cancellationToken: context.cancellation.token, expectedGeneration: context.connectionGeneration }),
                { logicalId, direction: 'withdraw' });
        }
        return this.#transferVerified('withdraw', logicalId, options);
    }

    async deposit(logicalId, options = {}) {
        if (this.operationManager && !options.operationContext) {
            return this.#runManaged('PersonalVaultService.deposit', ['gui', 'inventory', 'personal-vault'], options,
                context => this.deposit(logicalId, { ...options, operationContext: context, cancellationToken: context.cancellation.token, expectedGeneration: context.connectionGeneration }),
                { logicalId, direction: 'deposit' });
        }
        return this.#transferVerified('deposit', logicalId, options);
    }

    async #transferVerified(direction, logicalId, options) {
        const cancellationToken = options.cancellationToken || null;
        const startedAt = Date.now();
        this.logger?.info?.('PV TRANSFER START', {
            operation: 'PersonalVaultService', step: direction, phase: 'START',
            action: direction === 'withdraw' ? 'withdraw from /pv 2' : 'deposit to /pv 2',
            resource: logicalId, direction
        });
        const opened = await this.open({ ...options, cancellationToken });
        if (!opened.success) return opened;
        try {
            const beforeVaultSnapshot = typeof this.reader.readAndLearn === 'function'
                ? await this.reader.readAndLearn(opened.data.window, { source: `personal-vault-${direction}-before` })
                : this.reader.read(opened.data.window);
            const beforeVault = Number(beforeVaultSnapshot.totals?.[logicalId] || 0);
            const beforeInventory = this.#inventoryCount(logicalId);
            const result = direction === 'withdraw'
                ? await this.transfer.transferToInventory(logicalId, {
                    ...options,
                    cancellationToken,
                    expectedGeneration: this.#expectedGeneration(options),
                    operationId: options.operationContext?.operationId || options.operationId || null,
                    correlationId: options.operationContext?.correlationId || options.correlationId || null
                })
                : await this.transfer.transferFromInventory(logicalId, {
                    ...options,
                    cancellationToken,
                    expectedGeneration: this.#expectedGeneration(options),
                    operationId: options.operationContext?.operationId || options.operationId || null,
                    correlationId: options.operationContext?.correlationId || options.correlationId || null
                });

            if (result.movedStacks <= 0) {
                const wrapped = new FlowError(`No ${logicalId} stack was moved ${direction === 'withdraw' ? 'from' : 'to'} /pv 2.`, {
                    code: 'PV_TRANSFER_NOTHING_MOVED', subsystem: 'personal-vault', operation: 'PersonalVaultService',
                    step: direction, action: direction === 'withdraw' ? 'shift-click vault item' : 'shift-click inventory item',
                    resource: logicalId, retryable: true,
                    details: { direction, beforeVault, beforeInventory, gui: this.guiManager.describeCurrent() }
                });
                return Result.fail(Status.NOT_FOUND, wrapped.message, wrapped, wrapped.toDiagnostic());
            }

            let last = null;
            for (let attempt = 1; attempt <= this.config.transferVerifyAttempts; attempt += 1) {
                cancellationToken?.throwIfCancelled?.();
                if (attempt > 1 && this.config.transferVerifyRetryMs > 0) {
                    await Timeout.delay(this.config.transferVerifyRetryMs, { cancellationToken });
                }
                const session = this.guiManager.syncCurrentWindow?.() || opened.data;
                const afterVaultSnapshot = session?.window
                    ? (typeof this.reader.readAndLearn === 'function'
                        ? await this.reader.readAndLearn(session.window, { source: `personal-vault-${direction}-after` })
                        : this.reader.read(session.window))
                    : beforeVaultSnapshot;
                const afterVault = Number(afterVaultSnapshot.totals?.[logicalId] || 0);
                const afterInventory = this.#inventoryCount(logicalId);
                const verified = direction === 'withdraw'
                    ? (afterInventory > beforeInventory || afterVault < beforeVault)
                    : (afterInventory < beforeInventory || afterVault > beforeVault);
                last = { attempt, beforeVault, afterVault, beforeInventory, afterInventory };
                if (verified) {
                    await this.#remember(afterVaultSnapshot);
                    this.logger?.info?.('PV TRANSFER OK', {
                        operation: 'PersonalVaultService', step: `${direction}-verify`, phase: 'OK',
                        action: direction, resource: logicalId, direction,
                        movedStacks: result.movedStacks,
                        before: { vault: beforeVault, inventory: beforeInventory },
                        after: { vault: afterVault, inventory: afterInventory },
                        elapsedMs: Date.now() - startedAt
                    });
                    return Result.ok({ ...result, verified: true, verification: last });
                }
            }

            const wrapped = new FlowError(`Personal vault ${direction} could not be verified for ${logicalId}.`, {
                code: 'PV_TRANSFER_VERIFICATION_FAILED', subsystem: 'personal-vault', operation: 'PersonalVaultService',
                step: `${direction}-verify`, action: 'compare /pv 2 and inventory before/after', resource: logicalId,
                details: {
                    direction, movedStacks: result.movedStacks, ...last,
                    logicalBinding: this.guiKnowledge?.getLogicalBinding?.(logicalId) || null,
                    gui: this.guiManager.describeCurrent()
                }
            });
            return Result.fail(Status.VERIFICATION_FAILED, wrapped.message, wrapped, wrapped.toDiagnostic());
        } catch (error) {
            const wrapped = FlowError.wrap(error, {
                code: error?.code || 'PV_TRANSFER_FAILED', subsystem: 'personal-vault', operation: 'PersonalVaultService',
                step: direction, action: direction, resource: logicalId, details: {
                    logicalBinding: this.guiKnowledge?.getLogicalBinding?.(logicalId) || null,
                    gui: this.guiManager.describeCurrent()
                }
            });
            return Result.fail(Operation.statusForError(error), wrapped.message, wrapped, wrapped.toDiagnostic());
        }
    }


    async #closeForeignGuiAndSettle(cancellationToken = null) {
        const current = this.guiManager.syncCurrentWindow?.() || this.guiManager.current?.();
        if (!current?.active || this.#isCurrentVaultSession(current)) return;
        await this.guiManager.closeCurrentWindow();
        const deadline = Date.now() + this.config.openCloseConfirmTimeoutMs;
        while (Date.now() <= deadline) {
            cancellationToken?.throwIfCancelled?.();
            const remaining = this.guiManager.syncCurrentWindow?.() || this.guiManager.current?.();
            if (!remaining?.active) break;
            await Timeout.delay(50, { cancellationToken });
        }
        const remaining = this.guiManager.syncCurrentWindow?.() || this.guiManager.current?.();
        if (remaining?.active) {
            throw new FlowError('Current GUI did not close before /pv 2.', {
                code: 'PV_PREOPEN_GUI_NOT_CLOSED', subsystem: 'personal-vault', operation: 'PersonalVaultService',
                step: 'open-precondition', action: 'close current GUI before /pv 2', resource: 'personalVault2', retryable: true
            });
        }
        if (this.config.openAfterCloseSettleMs > 0) {
            await Timeout.delay(this.config.openAfterCloseSettleMs, { cancellationToken });
        }
    }

    #isCurrentVaultSession(session) {
        if (!session?.active || !session.window) return false;
        const source = session.source || null;
        const sourceMatches = source?.commandKey === this.config.commandKey || source?.command === '/pv 2';
        if (typeof this.guiManager?.identify !== 'function') return sourceMatches;
        const identity = this.guiManager.identify(session, {
            expectedId: sourceMatches ? this.config.guiId : null,
            source: sourceMatches ? this.source : source
        });
        return Boolean(identity?.id === this.config.guiId && Number(identity?.confidence || 0) >= 0.58);
    }

    #inventoryCount(logicalId) {
        if (!this.inventoryReader || !this.inventoryCounter) return 0;
        const views = typeof this.inventoryReader.readViews === 'function'
            ? this.inventoryReader.readViews()
            : [this.inventoryReader.read()];
        let best = 0;
        for (const snapshot of views || []) best = Math.max(best, this.inventoryCounter.count(snapshot, logicalId));
        return best;
    }

    async #remember(snapshot) {
        if (!this.guiKnowledge) return;
        await this.guiKnowledge.setSemantic(this.source, 'personalVault', {
            items: snapshot.items,
            totals: snapshot.totals,
            slotCount: snapshot.slotCount,
            occupiedSlotCount: snapshot.occupiedSlotCount,
            emptySlotCount: snapshot.emptySlotCount,
            capturedAt: snapshot.capturedAt
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
        throw new FlowError('Personal vault operation belongs to a stale connection generation.', {
            code: 'DISCONNECTED', subsystem: 'personal-vault', operation: 'PersonalVaultService', step: 'generation-guard', retryable: true,
            details: { expectedGeneration, currentGeneration: this.context.getGeneration?.() ?? null }
        });
    }

    #runManaged(name, lockKeys, options, action, metadata = null) {
        const expectedGeneration = this.#expectedGeneration(options);
        const operation = new Operation({ name, lockKeys, returnsResult: true, execute: action });
        return this.operationManager.run(operation, {
            operationContext: options.operationContext || null,
            cancellationToken: options.cancellationToken || null,
            connectionGeneration: expectedGeneration,
            timeoutMs: options.timeoutMs,
            queueWaitTimeoutMs: options.queueWaitTimeoutMs,
            correlationId: options.correlationId || null,
            metadata: { subsystem: 'personal-vault', ...(metadata || {}) }
        });
    }

    #validateConfig(config) {
        if (!config || typeof config !== 'object') throw new TypeError('personalVault config is required');
        if (typeof config.commandKey !== 'string' || !config.commandKey) throw new Error('personalVault.commandKey is required');
        if (!Number.isInteger(config.storageSlots) || config.storageSlots <= 0) throw new Error('personalVault.storageSlots must be a positive integer');
        if (!Number.isFinite(config.guiTimeoutMs) || config.guiTimeoutMs <= 0) throw new Error('personalVault.guiTimeoutMs must be positive');
        return {
            ...config,
            openSettleMs: Number.isFinite(config.openSettleMs) && config.openSettleMs >= 0 ? config.openSettleMs : 150,
            openAttempts: Number.isInteger(config.openAttempts) && config.openAttempts > 0 ? config.openAttempts : 3,
            openAfterCloseSettleMs: Number.isFinite(config.openAfterCloseSettleMs) && config.openAfterCloseSettleMs >= 0 ? config.openAfterCloseSettleMs : 1000,
            openCloseConfirmTimeoutMs: Number.isFinite(config.openCloseConfirmTimeoutMs) && config.openCloseConfirmTimeoutMs >= 0 ? config.openCloseConfirmTimeoutMs : 1000,
            openRetryMs: Number.isFinite(config.openRetryMs) && config.openRetryMs >= 0 ? config.openRetryMs : 350,
            transferVerifyAttempts: Number.isInteger(config.transferVerifyAttempts) && config.transferVerifyAttempts > 0 ? config.transferVerifyAttempts : 8,
            transferVerifyRetryMs: Number.isFinite(config.transferVerifyRetryMs) && config.transferVerifyRetryMs >= 0 ? config.transferVerifyRetryMs : 200
        };
    }
}

module.exports = PersonalVaultService;
