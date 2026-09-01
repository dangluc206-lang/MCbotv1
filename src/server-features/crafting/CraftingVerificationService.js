'use strict';

class CraftingVerificationService {
    constructor({
        resultVerifier,
        stageContract,
        config = {}
    } = {}) {
        if (!resultVerifier) {
            throw new TypeError('CraftingVerificationService resultVerifier is required.');
        }

        if (!stageContract) {
            throw new TypeError('CraftingVerificationService stageContract is required.');
        }

        this.resultVerifier = resultVerifier;
        this.stageContract = stageContract;

        this.config = Object.freeze({
            attempts: Math.max(1, Number(config.attempts ?? 10)),
            retryMs: Math.max(0, Number(config.retryMs ?? 300)),
            settlementEnabled: config.settlementEnabled !== false
        });
    }

    reconfigure(config = {}) {
        const next = config || {};

        this.config = Object.freeze({
            ...this.config,
            ...(Object.prototype.hasOwnProperty.call(next, 'attempts')
                ? { attempts: Math.max(1, Number(next.attempts) || 1) }
                : {}),
            ...(Object.prototype.hasOwnProperty.call(next, 'retryMs')
                ? { retryMs: Math.max(0, Number(next.retryMs) || 0) }
                : {}),
            ...(Object.prototype.hasOwnProperty.call(next, 'settlementEnabled')
                ? { settlementEnabled: next.settlementEnabled !== false }
                : {})
        });

        return this;
    }

    before(outputId, inputIds = [], options = {}) {
        return this.resultVerifier.before(outputId, inputIds, options);
    }

    arm(before) {
        return this.resultVerifier.arm(before);
    }

    async after(outputId, before, options = {}) {
        return this.resultVerifier.after(outputId, before, {
            attempts: options.attempts ?? this.config.attempts,
            retryMs: options.retryMs ?? this.config.retryMs,
            ...options
        });
    }

    async waitForOutputCompletion(options = {}) {
        return this.resultVerifier.waitForOutputCompletion(options);
    }

    async settleAfterCraft(options = {}) {
        if (!this.config.settlementEnabled) return null;
        return this.resultVerifier.settleAfterCraft(options);
    }

    requireInputReady(options) {
        return this.stageContract.requireInputReady(options);
    }

    verifyOutput(options) {
        return this.stageContract.verifyOutput(options);
    }

    requireSettled(options) {
        return this.stageContract.requireSettled(options);
    }

    handoff(options) {
        return this.stageContract.handoff(options);
    }
}

module.exports = CraftingVerificationService;