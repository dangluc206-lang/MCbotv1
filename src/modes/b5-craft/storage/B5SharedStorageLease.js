'use strict';

class B5SharedStorageLease {
    constructor({ registry = null, resourceKey = null, botId }) {
        this.registry = registry;
        this.resourceKey = resourceKey;
        this.botId = botId;
        this.lease = null;
    }

    async acquire({ batchId, generation, cancellationToken }) {
        if (!this.registry || !this.resourceKey || this.lease) return this.lease;
        this.lease = await this.registry.acquire(this.resourceKey, {
            owner: `${this.botId}:b5:${batchId}:g${generation}`,
            cancellationToken
        });
        return this.lease;
    }

    release(reason) {
        const lease = this.lease;
        this.lease = null;
        return lease?.release?.(reason) || false;
    }

    status() {
        return this.lease ? Object.freeze({
            id: this.lease.id, key: this.lease.key, owner: this.lease.owner, acquiredAt: this.lease.acquiredAt
        }) : null;
    }
}

module.exports = B5SharedStorageLease;
