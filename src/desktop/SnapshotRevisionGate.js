'use strict';

function normalizeRevision(value) {
    const revision = Number(value);
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

class SnapshotRevisionGate {
    constructor() {
        this.lastRevision = null;
        this.lastSnapshot = null;
    }

    accept(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') return false;
        const revision = normalizeRevision(snapshot.stateRevision);
        if (revision === null) {
            if (this.lastRevision !== null) return false;
            this.lastSnapshot = snapshot;
            return true;
        }
        if (this.lastRevision !== null && revision <= this.lastRevision) return false;
        this.lastRevision = revision;
        this.lastSnapshot = snapshot;
        return true;
    }

    coalesce(snapshot) {
        return this.accept(snapshot) ? snapshot : this.lastSnapshot;
    }

    reset() {
        this.lastRevision = null;
        this.lastSnapshot = null;
    }

    status() {
        return { lastRevision: this.lastRevision };
    }
}

module.exports = SnapshotRevisionGate;
