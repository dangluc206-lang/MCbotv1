'use strict';

class SubscriptionBag {
    constructor({ name = 'SubscriptionBag', logger = null } = {}) {
        this.name = String(name || 'SubscriptionBag');
        this.logger = logger;
        this.cleanups = new Set();
        this.closed = false;
    }

    add(cleanup) {
        if (typeof cleanup !== 'function') throw new TypeError('SubscriptionBag cleanup must be a function.');
        if (this.closed) {
            this.#run(cleanup);
            return () => {};
        }
        this.cleanups.add(cleanup);
        return () => this.remove(cleanup);
    }

    remove(cleanup) {
        return this.cleanups.delete(cleanup);
    }

    listen(target, event, listener, options = {}) {
        if (!target) throw new TypeError('SubscriptionBag listen target is required.');
        if (typeof listener !== 'function') throw new TypeError('SubscriptionBag listener must be a function.');
        let cleanup;
        if (typeof target.on === 'function' && typeof target.off === 'function') {
            target.on(event, listener, options);
            cleanup = () => target.off(event, listener, options);
        } else if (typeof target.addEventListener === 'function' && typeof target.removeEventListener === 'function') {
            target.addEventListener(event, listener, options);
            cleanup = () => target.removeEventListener(event, listener, options);
        } else {
            throw new TypeError('SubscriptionBag target must support on/off or addEventListener/removeEventListener.');
        }
        return this.add(cleanup);
    }

    interval(callback, delayMs, ...args) {
        if (typeof callback !== 'function') throw new TypeError('SubscriptionBag interval callback must be a function.');
        if (!Number.isFinite(delayMs) || delayMs < 0) throw new TypeError('SubscriptionBag interval delay must be non-negative.');
        const timer = setInterval(callback, delayMs, ...args);
        this.add(() => clearInterval(timer));
        return timer;
    }

    timeout(callback, delayMs, ...args) {
        if (typeof callback !== 'function') throw new TypeError('SubscriptionBag timeout callback must be a function.');
        if (!Number.isFinite(delayMs) || delayMs < 0) throw new TypeError('SubscriptionBag timeout delay must be non-negative.');
        const timer = setTimeout(() => {
            this.cleanups.delete(cleanup);
            callback(...args);
        }, delayMs);
        const cleanup = () => clearTimeout(timer);
        this.add(cleanup);
        return timer;
    }

    async clear() {
        const cleanups = [...this.cleanups];
        this.cleanups.clear();
        const failures = [];
        for (const cleanup of cleanups.reverse()) {
            try {
                await cleanup();
            } catch (error) {
                failures.push(error);
                this.logger?.warn?.('Subscription cleanup failed.', { bag: this.name, error });
            }
        }
        return failures;
    }

    async close() {
        if (this.closed) return [];
        this.closed = true;
        return this.clear();
    }

    size() {
        return this.cleanups.size;
    }

    #run(cleanup) {
        try {
            const value = cleanup();
            if (value?.catch) value.catch(error => this.logger?.warn?.('Late subscription cleanup failed.', { bag: this.name, error }));
        } catch (error) {
            this.logger?.warn?.('Late subscription cleanup failed.', { bag: this.name, error });
        }
    }
}

module.exports = SubscriptionBag;
