'use strict';

const Result = require('../shared/result/Result');
const Status = require('../shared/result/Status');
const Operation = require('../operations/Operation');
const { immutableClone } = require('../shared/utils/object');

class ModeControlService {
    constructor({ botId, registry, logger = null } = {}) {
        if (typeof botId !== 'string' || !botId.trim()) throw new TypeError('ModeControlService botId is required.');
        if (!registry?.transition || !registry?.status) throw new TypeError('ModeControlService registry is required.');
        this.botId = botId.trim();
        this.registry = registry;
        this.logger = logger;
    }

    list() {
        return this.registry.status().modes;
    }

    status(modeId = null) {
        return this.registry.status(modeId);
    }

    async start(modeId, { reason = 'Mode started through ModeControlService.' } = {}) {
        try {
            this.registry.assertReady(modeId);
            const definition = this.registry.catalog.require(modeId);
            if (definition.primary) {
                const disabled = await this.registry.disableAll(`Switching primary mode to ${modeId}.`, { except: modeId });
                const failed = disabled.find(entry => entry.result?.success === false);
                if (failed) return failed.result;
            }
            return await this.registry.transition(modeId, 'enable', reason);
        } catch (error) {
            this.logger?.warn?.('Mode start rejected.', { botId: this.botId, modeId, error });
            return Result.fail(this.#status(error), error.message, error, { botId: this.botId, modeId });
        }
    }

    async pause(modeId, reason = 'Mode paused through ModeControlService.') {
        return this.#transition(modeId, 'pause', reason);
    }

    async resume(modeId) {
        return this.#transition(modeId, 'resume');
    }

    async stop(modeId, reason = 'Mode stopped through ModeControlService.') {
        return this.#transition(modeId, 'disable', reason);
    }

    async restart(modeId, { reason = 'Mode restarted through ModeControlService.' } = {}) {
        const service = this.registry.require(modeId);
        if (service.status().enabled) {
            const stopped = await service.disable(reason);
            if (stopped?.success === false) return stopped;
        }
        return this.start(modeId, { reason });
    }

    async stopAll(reason = 'All modes stopped through ModeControlService.') {
        try {
            const results = await this.registry.disableAll(reason);
            const failure = results.find(entry => entry.result?.success === false);
            if (failure) return failure.result;
            return Result.ok(immutableClone(results));
        } catch (error) {
            return Result.fail(this.#status(error), error.message, error, { botId: this.botId });
        }
    }

    async #transition(modeId, action, reason = null) {
        try {
            return await this.registry.transition(modeId, action, reason);
        } catch (error) {
            this.logger?.warn?.('Mode transition rejected.', { botId: this.botId, modeId, action, error });
            return Result.fail(this.#status(error), error.message, error, { botId: this.botId, modeId, action });
        }
    }

    #status(error) {
        if (['MODE_CAPABILITIES_UNMET', 'CAPABILITY_REQUIREMENTS_UNMET', 'CAPABILITY_NOT_READY', 'MODE_SERVICE_NOT_BOUND'].includes(error?.code)) {
            return Status.NOT_READY;
        }
        if (['MODE_NOT_REGISTERED', 'MODE_CONTRACT_INVALID'].includes(error?.code)) return Status.INVALID_INPUT;
        return Operation.statusForError(error);
    }
}

module.exports = ModeControlService;
