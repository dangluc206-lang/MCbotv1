'use strict';

/*
 * P0-1 lifecycle guard.
 * The full DesktopController implementation is preserved in
 * DesktopControllerBase.js. This compatibility entrypoint owns only the
 * lifecycle transaction boundary so existing imports keep working.
 */
const DesktopControllerBase = require('./DesktopControllerBase');

function lifecycleError(code, message) {
    return Object.assign(new Error(message), { code });
}

class DesktopController extends DesktopControllerBase {
    constructor(options = {}) {
        super(options);
        this.stopPromise = null;
        this.stopFailureTransaction = null;
    }

    async start() {
        if (this.stopPromise) {
            await this.stopPromise;
        }
        if (this.lifecycle === 'STOPPING') {
            throw lifecycleError('DESKTOP_LIFECYCLE_STOP_INCOMPLETE', 'Desktop backend stop transaction has not completed.');
        }
        if (this.lifecycle === 'FAILED' && this.bundle) {
            throw lifecycleError('DESKTOP_LIFECYCLE_STOP_REQUIRED', 'Desktop backend has a failed lifecycle transaction; stop must complete before start.');
        }
        return super.start();
    }

    async stop(reason = 'Desktop application shutting down.') {
        if (this.stopPromise) return this.stopPromise;

        const transaction = this.#beginStopTransaction();
        const currentStart = this.lifecycle === 'STARTING' ? this.startPromise : null;
        const promise = (async () => {
            if (currentStart) {
                try {
                    await currentStart;
                } catch {
                    // Base start performs bounded startup cleanup. If startup
                    // failed, continue into the normal stopped-state path.
                }
            }
            return this.#executeStop(reason, transaction);
        })();

        this.stopPromise = promise;
        try {
            return await promise;
        } finally {
            if (this.stopPromise === promise) this.stopPromise = null;
        }
    }

    #beginStopTransaction() {
        if (this.stopFailureTransaction && this.stopFailureTransaction.bundle === this.bundle) {
            return this.stopFailureTransaction;
        }
        const transaction = {
            bundle: this.bundle,
            stopCompleted: false,
            destroyAttempts: 0
        };
        this.stopFailureTransaction = transaction;
        return transaction;
    }

    async #executeStop(reason, transaction) {
        if (!this.bundle) {
            this.stopFailureTransaction = null;
            this.lifecycle = 'STOPPED';
            return { success: true };
        }

        if (transaction.bundle !== this.bundle) {
            transaction.bundle = this.bundle;
            transaction.stopCompleted = false;
            transaction.destroyAttempts = 0;
        }

        const application = transaction.bundle.application;
        const originalStop = application.stop;
        const originalDestroy = application.destroy;
        const wrappedStop = async (...args) => {
            const value = await originalStop.apply(application, args);
            transaction.stopCompleted = true;
            return value;
        };
        const wrappedDestroy = async (...args) => {
            transaction.destroyAttempts += 1;
            return originalDestroy.apply(application, args);
        };
        application.stop = wrappedStop;
        application.destroy = wrappedDestroy;

        try {
            if (transaction.stopCompleted) {
                this.lifecycle = 'STOPPING';
                await originalDestroy.apply(application);
                this.#finalizeSuccessfulStop(reason, transaction);
                return { success: true };
            }
            return await super.stop(reason);
        } catch (error) {
            // Base stop clears controller state in its finally block even when
            // a lifecycle primitive fails. Restore the transaction-owned bundle
            // so a later stop can retry only the incomplete primitive.
            this.bundle = transaction.bundle;
            this.startedAt = null;
            this.runtimeFailureArtifactRepository = null;
            this.supportPreviewCache = null;
            this.lifecycle = transaction.stopCompleted ? 'STOPPING' : 'FAILED';
            this.stopFailureTransaction = transaction;
            throw error;
        } finally {
            if (transaction.bundle?.application === application) {
                application.stop = originalStop;
                application.destroy = originalDestroy;
            }
        }
    }

    #finalizeSuccessfulStop(reason, transaction) {
        if (this.bundle !== transaction.bundle) this.bundle = transaction.bundle;
        this.bundle = null;
        this.lifecycle = 'STOPPED';
        this.startedAt = null;
        this.runtimeFailureArtifactRepository = null;
        this.supportPreviewCache = null;
        this.logPolicy?.reset?.();
        this.stopFailureTransaction = null;
        // The base implementation owns the canonical stopped log. A destroy
        // retry is exceptional; do not synthesize another event here.
    }
}

module.exports = DesktopController;
