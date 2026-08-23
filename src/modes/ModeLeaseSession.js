'use strict';

const { immutableClone } = require('../shared/utils/object');

class ModeLeaseSession {
    constructor({ modeId, modeCoordinator, requestedResources = ['primary-mode'], logger = null } = {}) {
        if (typeof modeId !== 'string' || !modeId.trim()) throw new TypeError('ModeLeaseSession modeId is required.');
        if (!modeCoordinator?.acquire || !modeCoordinator?.pause || !modeCoordinator?.resume || !modeCoordinator?.release || !modeCoordinator?.isHeldBy) {
            throw new TypeError('ModeLeaseSession modeCoordinator is required.');
        }
        if (!Array.isArray(requestedResources) || requestedResources.length === 0) throw new TypeError('ModeLeaseSession requestedResources are required.');
        this.modeId = modeId.trim();
        this.modeCoordinator = modeCoordinator;
        this.requestedResources = Object.freeze([...new Set(requestedResources.map(value => String(value || '').trim()).filter(Boolean))].sort());
        if (!this.requestedResources.length) throw new TypeError('ModeLeaseSession requestedResources are required.');
        this.logger = logger;
        this.lease = null;
    }

    acquire({ reason = null, metadata = null } = {}) {
        const result = this.modeCoordinator.acquire(this.modeId, {
            requestedResources: this.requestedResources,
            reason,
            metadata
        });
        if (result?.success) this.lease = result.data;
        return result;
    }

    pause() {
        return this.modeCoordinator.pause(this.modeId, this.lease);
    }

    resume() {
        return this.modeCoordinator.resume(this.modeId, this.lease);
    }

    release() {
        const lease = this.lease;
        const result = this.modeCoordinator.release(this.modeId, lease);
        if (result?.success) this.lease = null;
        return result;
    }

    isHeld(resource = 'primary-mode') {
        return this.modeCoordinator.isHeldBy(this.modeId, this.lease, resource);
    }

    leaseId() {
        return this.lease?.leaseId || null;
    }

    current() {
        return this.lease ? immutableClone(this.lease) : null;
    }

    status() {
        return this.modeCoordinator.status(this.modeId);
    }

    owner(resource = 'primary-mode') {
        return this.modeCoordinator.owner(resource);
    }

    matchesRelease(change) {
        return Boolean(
            change?.type === 'released'
            && change?.lease?.modeId === this.modeId
            && this.lease
            && change.lease.leaseId === this.lease.leaseId
        );
    }
}

module.exports = ModeLeaseSession;
