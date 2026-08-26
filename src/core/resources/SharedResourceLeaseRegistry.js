'use strict';

class SharedResourceLeaseRegistry {
    constructor({ logger = null } = {}) {
        this.logger = logger;
        this.resources = new Map();
        this.sequence = 0;
    }

    acquire(resourceKey, { owner, cancellationToken = null } = {}) {
        const key = String(resourceKey || '').trim();
        const normalizedOwner = String(owner || '').trim();
        if (!key || !normalizedOwner) throw new TypeError('Shared resource key and owner are required.');
        cancellationToken?.throwIfCancelled?.();
        const state = this.resources.get(key) || { active: null, queue: [] };
        this.resources.set(key, state);
        return new Promise((resolve, reject) => {
            const request = {
                id: `shared-lease:${++this.sequence}`, key, owner: normalizedOwner,
                createdAt: Date.now(), resolve, reject, offCancellation: null
            };
            request.offCancellation = cancellationToken?.onCancelled?.(reason => {
                const index = state.queue.indexOf(request);
                if (index < 0) return;
                state.queue.splice(index, 1);
                this.#cleanup(key, state);
                reject(Object.assign(new Error(String(reason || 'Shared resource lease cancelled.')), { code: 'CANCELLED' }));
            }) || null;
            state.queue.push(request);
            this.#grantNext(key, state);
        });
    }

    status() {
        const resources = {};
        for (const [key, state] of [...this.resources.entries()].sort(([left], [right]) => left.localeCompare(right))) {
            resources[key] = {
                active: state.active ? { id: state.active.id, owner: state.active.owner, acquiredAt: state.active.acquiredAt } : null,
                queued: state.queue.map(request => ({ id: request.id, owner: request.owner, createdAt: request.createdAt }))
            };
        }
        return Object.freeze({ resources: Object.freeze(resources) });
    }

    #grantNext(key, state) {
        if (state.active || state.queue.length === 0) return;
        const request = state.queue.shift();
        request.offCancellation?.();
        let released = false;
        const lease = Object.freeze({
            id: request.id, key, owner: request.owner, acquiredAt: Date.now(),
            release: reason => {
                if (released) return false;
                released = true;
                if (state.active?.id !== request.id) return false;
                state.active = null;
                this.logger?.debug?.('Shared resource lease released.', { resourceKey: key, owner: request.owner, leaseId: request.id, reason: reason || null });
                this.#grantNext(key, state);
                this.#cleanup(key, state);
                return true;
            }
        });
        state.active = lease;
        this.logger?.debug?.('Shared resource lease acquired.', { resourceKey: key, owner: request.owner, leaseId: request.id, waitMs: lease.acquiredAt - request.createdAt });
        request.resolve(lease);
    }

    #cleanup(key, state) {
        if (!state.active && state.queue.length === 0) this.resources.delete(key);
    }
}

module.exports = SharedResourceLeaseRegistry;
