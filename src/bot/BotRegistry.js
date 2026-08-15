'use strict';

const BotNotFoundError = require('./errors/BotNotFoundError');
const BotAlreadyExistsError = require('./errors/BotAlreadyExistsError');
const Redactor = require('../shared/security/Redactor');

class BotRegistry {
    constructor({ logger = null } = {}) {
        this.runtimes = new Map();
        this.changeListeners = new Set();
        this.logger = logger;
    }

    register(runtime) {
        const botId = runtime?.botId;
        if (typeof botId !== 'string' || !botId.trim()) throw new TypeError('runtime.botId is required');
        if (this.runtimes.has(botId)) throw new BotAlreadyExistsError(botId);
        this.runtimes.set(botId, runtime);
        this.#notify({ type: 'registered', botId, runtime });
        return runtime;
    }

    get(botId) { return this.runtimes.get(botId) || null; }

    require(botId) {
        const runtime = this.get(botId);
        if (!runtime) throw new BotNotFoundError(botId);
        return runtime;
    }

    has(botId) { return this.runtimes.has(botId); }

    remove(botId, expectedRuntime = null) {
        const current = this.runtimes.get(botId);
        if (!current) return false;
        if (expectedRuntime && current !== expectedRuntime) return false;
        this.runtimes.delete(botId);
        this.#notify({ type: 'removed', botId, runtime: current });
        return true;
    }

    onChange(listener) {
        if (typeof listener !== 'function') throw new TypeError('BotRegistry change listener must be a function.');
        this.changeListeners.add(listener);
        return () => this.changeListeners.delete(listener);
    }

    list() { return [...this.runtimes.values()]; }
    ids() { return [...this.runtimes.keys()]; }
    size() { return this.runtimes.size; }

    clear() {
        for (const botId of this.ids()) this.remove(botId);
    }

    #notify(change) {
        const immutableChange = Object.freeze({ ...change });
        for (const listener of [...this.changeListeners]) {
            try {
                listener(immutableChange);
            } catch (error) {
                this.logger?.warn?.('BotRegistry change listener failed after registry mutation.', {
                    botId: change.botId,
                    type: change.type,
                    error: Redactor.sanitize(error)
                });
            }
        }
    }
}

module.exports = BotRegistry;
