'use strict';

const Result = require('../../shared/result/Result');
const Status = require('../../shared/result/Status');
const Operation = require('../../operations/Operation');
const { immutableClone } = require('../../shared/utils/object');

class FleetReconciler {
    constructor({ store, scheduler, requireRuntime, profileFor, modeCatalog = null, logger = null }) {
        Object.assign(this, { store, scheduler, requireRuntime, profileFor, modeCatalog, logger });
        this.lastOutcomes = new Map();
    }

    async reconcileBot(botId, { reason = 'reconcile', priority = 'normal', expectedRevision = null, forceModeRestart = false } = {}) {
        try {
            let value = null;
            let restartPending = forceModeRestart;
            for (let attempt = 1; attempt <= 8; attempt += 1) {
                value = await this.scheduler.schedule({
                    botId,
                    key: forceModeRestart ? 'durable-intent-mode-restart' : 'durable-intent-reconcile',
                    priority,
                    run: async context => {
                        if (restartPending) {
                            restartPending = false;
                            const runtime = this.requireRuntime(botId);
                            const profile = this.profileFor(botId);
                            if (profile && profile.enabled !== false) {
                                context.cancellationToken.throwIfCancelled();
                                await this.resetRuntime(runtime, 'Durable mode restart requested.', context.cancellationToken);
                            }
                        }
                        return this.#reconcileUntilCurrent(botId, context, reason);
                    }
                });
                if (expectedRevision === null || value.status === 'NO_INTENT' || Number(value.intentRevision || 0) >= Number(expectedRevision)) break;
                if (attempt === 8) {
                    const error = new Error(`Intent revision ${expectedRevision} was not reconciled for ${botId}.`);
                    error.code = 'INTENT_RECONCILE_LIVELOCK';
                    throw error;
                }
            }
            const current = this.store.get(botId);
            if (expectedRevision !== null && current && current.revision < expectedRevision) {
                throw new Error(`Intent revision ${expectedRevision} was not published for ${botId}.`);
            }
            this.lastOutcomes.set(botId, immutableClone(value));
            if (String(value.status).startsWith('BLOCKED')) return Result.fail(Status.NOT_READY, value.message || value.status, null, value);
            return Result.ok(value);
        } catch (error) {
            this.logger?.error?.('Fleet intent reconciliation failed.', { botId, reason, error });
            return Result.fail(Operation.statusForError(error), error.message, error, { botId, reason });
        }
    }

    outcomes() {
        return Object.fromEntries([...this.lastOutcomes.entries()].sort(([left], [right]) => left.localeCompare(right)));
    }

    async resetRuntime(runtime, reason, cancellationToken = null) {
        await this.#disableModes(runtime, reason, cancellationToken);
        cancellationToken?.throwIfCancelled?.();
        runtime.getService?.('operationManager')?.cancelAll?.(reason);
        cancellationToken?.throwIfCancelled?.();
        await runtime.getService?.('movementManager')?.stop?.();
        cancellationToken?.throwIfCancelled?.();
        await runtime.getService?.('guiManager')?.closeCurrentWindow?.();
    }

    async #reconcileUntilCurrent(botId, taskContext, reason) {
        let outcome = null;
        for (let pass = 1; pass <= 8; pass += 1) {
            taskContext.cancellationToken.throwIfCancelled();
            const intent = this.store.get(botId);
            if (!intent) return { botId, status: 'NO_INTENT', reason, pass };
            outcome = await this.#applyIntent(botId, intent, taskContext);
            const latest = this.store.get(botId);
            if (latest?.revision === intent.revision) return { ...outcome, botId, intentRevision: intent.revision, reason, pass };
        }
        const error = new Error(`Intent for ${botId} changed too often during reconciliation.`);
        error.code = 'INTENT_RECONCILE_LIVELOCK';
        throw error;
    }

    async #applyIntent(botId, intent, taskContext) {
        const runtime = this.requireRuntime(botId);
        const profile = this.profileFor(botId);
        if (!profile) return { status: 'BLOCKED_PROFILE_MISSING', message: `Bot profile is missing: ${botId}` };
        if (intent.desiredConnection === 'CONNECTED' && profile.enabled === false) return { status: 'BLOCKED_PROFILE_DISABLED', message: `Bot profile is disabled: ${botId}` };

        taskContext.cancellationToken.throwIfCancelled();
        if (intent.desiredConnection === 'DISCONNECTED') {
            const reconnectManager = runtime.getService?.('reconnectManager');
            if (typeof reconnectManager?.suspend === 'function') reconnectManager.suspend('Durable intent requests disconnect.');
            else reconnectManager?.cancelPending?.('Durable intent requests disconnect.');
            await this.resetRuntime(runtime, 'Durable intent requests disconnect.', taskContext.cancellationToken);
            taskContext.cancellationToken.throwIfCancelled();
            await runtime.requireService('connectionManager').stop();
            return { status: 'APPLIED_DISCONNECTED', modeStatus: null };
        }

        runtime.getService?.('reconnectManager')?.resume?.('Durable intent requests connection.');
        if (!runtime.context.has()) await runtime.requireService('connectionManager').connect();
        taskContext.cancellationToken.throwIfCancelled();
        if (!runtime.context.has()) return { status: 'WAITING_CONNECTION', modeStatus: null };
        if (!intent.desiredMode) {
            await this.resetRuntime(runtime, 'Durable intent has no active mode.', taskContext.cancellationToken);
            return { status: 'APPLIED_CONNECTED_IDLE', modeStatus: null };
        }

        const target = await this.#selectMode(runtime, intent.desiredMode);
        taskContext.cancellationToken.throwIfCancelled();
        if (intent.modeState === 'PAUSED' && !target.status().enabled) {
            return { status: 'SAFE_PAUSED_NOT_REPLAYED', message: 'Paused mode intent was not re-enabled because recovery never replays startup side effects merely to pause.', modeStatus: target.status() };
        }
        if (!target.status().enabled) {
            const enabled = await target.enable();
            if (enabled?.success === false) throw enabled.error || new Error(enabled.message || `Failed to enable ${intent.desiredMode}.`);
        }
        taskContext.cancellationToken.throwIfCancelled();
        if (intent.modeState === 'PAUSED' && !target.status().paused) {
            const paused = await target.pause('Restored durable paused intent.');
            if (paused?.success === false) throw paused.error || new Error(paused.message || `Failed to pause ${intent.desiredMode}.`);
        } else if (intent.modeState === 'ACTIVE' && target.status().paused) {
            const resumed = await target.resume();
            if (resumed?.success === false) throw resumed.error || new Error(resumed.message || `Failed to resume ${intent.desiredMode}.`);
        }
        return { status: intent.modeState === 'PAUSED' ? 'APPLIED_MODE_PAUSED' : 'APPLIED_MODE_ACTIVE', modeStatus: target.status() };
    }

    async #selectMode(runtime, desiredMode) {
        const modeRegistry = runtime.getService?.('modeRegistry');
        if (modeRegistry) {
            modeRegistry.assertReady(desiredMode);
            const target = modeRegistry.require(desiredMode);
            const disabledModes = await modeRegistry.disableAll('Durable intent switched primary mode.', { except: desiredMode });
            for (const entry of disabledModes) {
                if (entry.result?.success === false) throw entry.result.error || new Error(entry.result.message || `Failed to disable previous mode: ${entry.modeId}.`);
            }
            return target;
        }
        const definitions = this.#modeDefinitions();
        const definition = definitions.find(item => item.id === desiredMode);
        if (!definition) throw new Error(`Mode definition is missing: ${desiredMode}`);
        const target = runtime.requireService(definition.serviceName);
        for (const otherDefinition of definitions) {
            if (otherDefinition.id === desiredMode) continue;
            const other = runtime.getService?.(otherDefinition.serviceName);
            if (!other?.status?.().enabled) continue;
            const disabled = await other.disable('Durable intent switched primary mode.');
            if (disabled?.success === false) throw disabled.error || new Error(disabled.message || `Failed to disable previous mode: ${otherDefinition.id}.`);
        }
        return target;
    }

    async #disableModes(runtime, reason, cancellationToken = null) {
        cancellationToken?.throwIfCancelled?.();
        const registry = runtime.getService?.('modeRegistry');
        if (registry?.disableAll) {
            const results = await registry.disableAll(reason);
            for (const entry of results) {
                cancellationToken?.throwIfCancelled?.();
                if (entry.result?.success === false) throw entry.result.error || new Error(entry.result.message || `Failed to disable ${entry.modeId}.`);
            }
            return;
        }
        for (const definition of this.#modeDefinitions()) {
            cancellationToken?.throwIfCancelled?.();
            const mode = runtime.getService?.(definition.serviceName);
            if (!mode?.status?.().enabled) continue;
            const result = await mode.disable(reason);
            if (result?.success === false) throw result.error || new Error(result.message || `Failed to disable ${definition.id}.`);
        }
    }

    #modeDefinitions() {
        return this.modeCatalog?.list?.() || [
            { id: 'collector-b5', serviceName: 'collectorB5Mode' },
            { id: 'fishing', serviceName: 'fishingMode' }
        ];
    }
}

module.exports = FleetReconciler;
