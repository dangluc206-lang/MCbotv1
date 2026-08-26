'use strict';

class SnapshotDeliveryCoordinator {
    constructor({ send, schedule = setImmediate } = {}) {
        if (typeof send !== 'function') throw new TypeError('SnapshotDeliveryCoordinator send is required.');
        this.send = send;
        this.schedule = schedule;
        this.pending = null;
        this.scheduled = false;
        this.lastDigest = null;
        this.offered = 0;
        this.delivered = 0;
        this.coalesced = 0;
    }

    offer(snapshot) {
        this.offered += 1;
        if (!snapshot || snapshot.digest === this.lastDigest && !this.pending) return false;
        if (this.pending) this.coalesced += 1;
        this.pending = snapshot;
        if (this.scheduled) return true;
        this.scheduled = true;
        this.schedule(() => this.#flush());
        return true;
    }

    flushNow() { return this.#flush(); }

    status() {
        return { offered: this.offered, delivered: this.delivered, coalesced: this.coalesced, pending: Boolean(this.pending), lastDigest: this.lastDigest };
    }

    #flush() {
        this.scheduled = false;
        const snapshot = this.pending;
        this.pending = null;
        if (!snapshot || snapshot.digest === this.lastDigest) return false;
        this.send(snapshot);
        this.lastDigest = snapshot.digest;
        this.delivered += 1;
        return true;
    }
}

module.exports = SnapshotDeliveryCoordinator;
