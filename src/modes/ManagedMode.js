'use strict';

const Result = require('../shared/result/Result');
const Status = require('../shared/result/Status');
const Redactor = require('../shared/security/Redactor');
const { immutableClone } = require('../shared/utils/object');
const ModeLeaseSession = require('./ModeLeaseSession');
const Operation = require('../operations/Operation');

class ManagedMode {
    constructor({ modeId, botId, modeContext, modeCoordinator, catalog, logger = null } = {}) {
        if (typeof modeId !== 'string' || !modeId.trim()) throw new TypeError('ManagedMode modeId is required.');
        if (typeof botId !== 'string' || !botId.trim()) throw new TypeError('ManagedMode botId is required.');
        if (!modeContext?.requireCapabilities || !modeContext?.subscriptions) throw new TypeError('ManagedMode modeContext is required.');
        if (!modeCoordinator?.acquire || !modeCoordinator?.release) throw new TypeError('ManagedMode modeCoordinator is required.');
        if (!catalog?.require) throw new TypeError('ManagedMode catalog is required.');
        this.modeId = modeId.trim();
        this.botId = botId.trim();
        this.modeContext = modeContext;
        this.modeCoordinator = modeCoordinator;
        this.catalog = catalog;
        this.definition = catalog.require(this.modeId);
        this.logger = logger;
        this.enabled = false;
        this.paused = false;
        this.phase = 'OFF';
        this.startedAt = null;
        this.updatedAt = null;
        this.lastError = null;
        this.leaseSession = new ModeLeaseSession({
            modeId: this.modeId,
            modeCoordinator: this.modeCoordinator,
            requestedResources: this.definition.requestedResources,
            logger: this.logger
        });
        this.subscriptions = null;
        this.activeGeneration = null;
    }

    async enable() {
        if (this.enabled) return Result.ok(this.status(), { alreadyEnabled: true });
        let acquired = null;
        try {
            (this.modeContext.requireReadyCapabilities || this.modeContext.requireCapabilities).call(this.modeContext, this.definition.requiredCapabilities, `mode:${this.modeId}`);
            const result = this.leaseSession.acquire({
                reason: `${this.definition.label} enabled.`,
                metadata: { modeId: this.modeId }
            });
            if (!result.success) return result;
            acquired = result.data;
            this.enabled = true;
            this.paused = false;
            this.phase = 'STARTING';
            this.startedAt = this.#now();
            this.activeGeneration = this.modeContext.generation();
            this.updatedAt = this.startedAt;
            this.lastError = null;
            this.subscriptions = this.modeContext.subscriptions(this.modeId);
            await this.onEnable();
            if (!this.enabled) return Result.fail(Status.CANCELLED, `${this.definition.label} stopped during startup.`);
            this.phase = 'RUNNING';
            this.updatedAt = this.#now();
            return Result.ok(this.status(), { leaseId: acquired.leaseId });
        } catch (error) {
            await this.#cleanupFailedEnable(error, acquired);
            return Result.fail(this.#errorStatus(error), error.message, error, { botId: this.botId, modeId: this.modeId });
        }
    }

    async pause(reason = `${this.definition.label} paused.`) {
        if (!this.enabled) return Result.fail(Status.NOT_READY, `${this.definition.label} is not enabled.`);
        if (this.paused) return Result.ok(this.status(), { alreadyPaused: true });
        const transitioned = this.leaseSession.pause();
        if (!transitioned.success) return transitioned;
        this.phase = 'PAUSING';
        this.updatedAt = this.#now();
        try {
            await this.onPause(reason);
            this.paused = true;
            this.phase = 'PAUSED';
            this.updatedAt = this.#now();
            return Result.ok(this.status());
        } catch (error) {
            this.lastError = Redactor.sanitize({ message: error.message, code: error.code || null });
            this.leaseSession.resume();
            this.phase = 'RUNNING';
            return Result.fail(this.#errorStatus(error), error.message, error, { botId: this.botId, modeId: this.modeId });
        }
    }

    async resume() {
        if (!this.enabled) return Result.fail(Status.NOT_READY, `${this.definition.label} is not enabled.`);
        if (!this.paused) return Result.ok(this.status(), { alreadyRunning: true });
        try {
            (this.modeContext.requireReadyCapabilities || this.modeContext.requireCapabilities).call(this.modeContext, this.definition.requiredCapabilities, `mode:${this.modeId}`);
            const transitioned = this.leaseSession.resume();
            if (!transitioned.success) return transitioned;
            this.phase = 'RESUMING';
            this.updatedAt = this.#now();
            await this.onResume();
            this.activeGeneration = this.modeContext.generation();
            this.paused = false;
            this.phase = 'RUNNING';
            this.updatedAt = this.#now();
            this.lastError = null;
            return Result.ok(this.status());
        } catch (error) {
            this.leaseSession.pause();
            this.paused = true;
            this.phase = 'PAUSED_ERROR';
            this.updatedAt = this.#now();
            this.lastError = Redactor.sanitize({ message: error.message, code: error.code || null });
            return Result.fail(this.#errorStatus(error), error.message, error, { botId: this.botId, modeId: this.modeId });
        }
    }

    async disable(reason = `${this.definition.label} disabled.`) {
        if (!this.enabled) return Result.ok(this.status(), { alreadyDisabled: true });
        this.phase = 'STOPPING';
        this.updatedAt = this.#now();
        let hookError = null;
        try {
            await this.onDisable(reason);
        } catch (error) {
            hookError = error;
            this.logger?.warn?.('Managed mode disable hook failed.', { botId: this.botId, modeId: this.modeId, error });
        }
        const cleanupErrors = await this.subscriptions?.close?.() || [];
        this.subscriptions = null;
        const released = this.leaseSession.release();
        this.enabled = false;
        this.paused = false;
        this.phase = 'OFF';
        this.activeGeneration = null;
        this.updatedAt = this.#now();
        if (hookError) {
            this.lastError = Redactor.sanitize({ message: hookError.message, code: hookError.code || null });
            return Result.fail(this.#errorStatus(hookError), hookError.message, hookError, {
                botId: this.botId,
                modeId: this.modeId,
                cleanupFailures: cleanupErrors.length,
                leaseReleased: released.success
            });
        }
        this.lastError = cleanupErrors.length > 0 ? { message: `${cleanupErrors.length} cleanup action(s) failed.` } : null;
        return Result.ok(this.status(), { cleanupFailures: cleanupErrors.length, leaseReleased: released.success });
    }

    async stop(reason) { return this.disable(reason); }
    async destroy() { return this.disable(`${this.definition.label} destroyed.`); }

    status() {
        return immutableClone({
            modeId: this.modeId,
            label: this.definition.label,
            enabled: this.enabled,
            paused: this.paused,
            phase: this.phase,
            startedAt: this.startedAt,
            updatedAt: this.updatedAt,
            lastError: this.lastError,
            leaseId: this.leaseSession.leaseId(),
            activeGeneration: this.activeGeneration,
            details: Redactor.sanitize(this.statusDetails() || {})
        });
    }


    createTaskSupervisor(name = 'tasks', options = {}) {
        if (!this.subscriptions) throw new Error(`${this.definition.label} is not active; task supervisor cannot be created.`);
        const supervisor = this.modeContext.taskSupervisor(`${this.modeId}:${name}`, options);
        this.subscriptions.add(() => supervisor.close(`${this.definition.label} lifecycle ended.`));
        return supervisor;
    }

    setPhase(phase) {
        const value = String(phase || '').trim();
        if (!value) throw new TypeError('ManagedMode phase is required.');
        this.phase = value;
        this.updatedAt = this.#now();
    }

    // Subclasses override these hooks. They intentionally default to no-op so a
    // small mode can implement only the lifecycle phases it actually needs.
    async onEnable() {}
    async onPause() {}
    async onResume() {}
    async onDisable() {}
    statusDetails() { return {}; }

    async #cleanupFailedEnable(error, acquired) {
        this.lastError = Redactor.sanitize({ message: error.message, code: error.code || null });
        await this.subscriptions?.close?.();
        this.subscriptions = null;
        if (acquired) this.leaseSession.release();
        this.enabled = false;
        this.paused = false;
        this.phase = 'OFF';
        this.activeGeneration = null;
        this.updatedAt = this.#now();
    }

    #errorStatus(error) {
        if (['CAPABILITY_REQUIREMENTS_UNMET', 'MODE_CAPABILITIES_UNMET'].includes(error?.code)) return Status.NOT_READY;
        return Operation.statusForError(error);
    }

    #now() { return new Date().toISOString(); }
}

module.exports = ManagedMode;
