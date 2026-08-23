'use strict';

class OperationLockPolicy {
    constructor() {
        this.owners = new Map();
        this.validOwners = new WeakSet();
        this.ownerSequence = 0;
    }

    createOwner(label = 'operation') {
        const owner = Object.freeze({
            id: `${String(label || 'operation')}:${++this.ownerSequence}`
        });
        this.validOwners.add(owner);
        return owner;
    }

    isOwner(owner) { return Boolean(owner && typeof owner === 'object' && this.validOwners.has(owner)); }

    acquire(keys, owner) {
        if (!this.isOwner(owner)) throw new TypeError('lock owner must be issued by OperationLockPolicy');
        const list = [...new Set(keys || [])].sort();
        for (const key of list) {
            const current = this.owners.get(key);
            if (current && current.owner !== owner) return false;
        }
        for (const key of list) {
            const current = this.owners.get(key);
            if (current) current.depth += 1;
            else this.owners.set(key, { owner, depth: 1 });
        }
        return true;
    }

    release(keys, owner) {
        if (!this.isOwner(owner)) return false;
        let released = false;
        for (const key of [...new Set(keys || [])].sort()) {
            const current = this.owners.get(key);
            if (!current || current.owner !== owner) continue;
            current.depth -= 1;
            if (current.depth <= 0) this.owners.delete(key);
            released = true;
        }
        return released;
    }

    owner(key) {
        const current = this.owners.get(key);
        if (!current) return null;
        return typeof current.owner === 'object' && current.owner?.id ? current.owner.id : current.owner;
    }

    depth(key) { return this.owners.get(key)?.depth || 0; }

    snapshot() {
        return Object.freeze([...this.owners.entries()].map(([key, value]) => Object.freeze({
            key,
            owner: typeof value.owner === 'object' && value.owner?.id ? value.owner.id : String(value.owner),
            depth: value.depth
        })));
    }

    clear(owner = null) {
        if (owner !== null && !this.isOwner(owner)) return false;
        let cleared = false;
        for (const [key, value] of this.owners) {
            if (!owner || value.owner === owner) {
                this.owners.delete(key);
                cleared = true;
            }
        }
        return cleared;
    }
}

module.exports = OperationLockPolicy;