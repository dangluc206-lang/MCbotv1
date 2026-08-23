'use strict';

const { randomUUID } = require('node:crypto');
const Result = require('../shared/result/Result');
const Status = require('../shared/result/Status');
const Redactor = require('../shared/security/Redactor');
const { immutableClone } = require('../shared/utils/object');

const PRIMARY_RESOURCE = 'primary-mode';
const ACTIVE = 'ACTIVE';
const PAUSED = 'PAUSED';

class ModeCoordinator {
    constructor({ botId, logger = null, clock = () => Date.now(), idFactory = randomUUID } = {}) {
        if (typeof botId !== 'string' || !botId.trim()) throw new TypeError('ModeCoordinator botId is required.');
        if (typeof clock !== 'function') throw new TypeError('ModeCoordinator clock must be a function.');
        if (typeof idFactory !== 'function') throw new TypeError('ModeCoordinator idFactory must be a function.');
        this.name = 'ModeCoordinator';
        this.botId = botId.trim();
        this.logger = logger;
        this.clock = clock;
        this.idFactory = idFactory;
        this.lifecycleState = 'CREATED';
        this.leasesByMode = new Map();
        this.resourceOwners = new Map();
        this.listeners = new Set();
    }

    async initialize() {
        if (this.lifecycleState === 'DESTROYED') throw new Error('ModeCoordinator has been destroyed.');
        if (this.lifecycleState === 'CREATED' || this.lifecycleState === 'STOPPED') {
            this.lifecycleState = 'INITIALIZED';
        }
    }

    async start() {
        if (this.lifecycleState === 'DESTROYED') throw new Error('ModeCoordinator has been destroyed.');
        if (this.lifecycleState === 'CREATED' || this.lifecycleState === 'STOPPED') await this.initialize();
        this.lifecycleState = 'RUNNING';
    }

    acquire(modeId, {
        requestedResources = [PRIMARY_RESOURCE],
        reason = null,
        metadata = null
    } = {}) {
        const normalizedModeId = this.#modeId(modeId);
        const resources = this.#resources(requestedResources);
        if (['STOPPED', 'DESTROYED'].includes(this.lifecycleState)) {
            return Result.fail(Status.NOT_READY, 'Mode coordinator is not accepting leases.', null, {
                botId: this.botId,
                lifecycleState: this.lifecycleState
            });
        }

        const existing = this.leasesByMode.get(normalizedModeId);
        if (existing) {
            if (!this.#sameResources(existing.requestedResources, resources)) {
                return Result.fail(Status.INVALID_INPUT, 'An enabled mode cannot change its resource claims.', null, {
                    botId: this.botId,
                    modeId: normalizedModeId,
                    currentResources: existing.requestedResources,
                    requestedResources: resources
                });
            }
            return Result.ok(this.#leaseSnapshot(existing), { alreadyOwned: true });
        }

        for (const resource of resources) {
            const ownerLeaseId = this.resourceOwners.get(resource);
            if (!ownerLeaseId) continue;
            const owner = this.#leaseById(ownerLeaseId);
            return Result.fail(Status.BUSY, `Mode resource is already owned: ${resource}.`, null, {
                botId: this.botId,
                resource,
                owner: owner ? this.#leaseSnapshot(owner) : null
            });
        }

        const lease = {
            leaseId: String(this.idFactory()),
            botId: this.botId,
            modeId: normalizedModeId,
            acquiredAt: this.#timestamp(),
            updatedAt: this.#timestamp(),
            state: ACTIVE,
            requestedResources: resources,
            reason: reason == null ? null : String(reason),
            metadata: metadata == null ? null : Redactor.sanitize(metadata)
        };
        if (!lease.leaseId) throw new Error('ModeCoordinator idFactory returned an empty leaseId.');
        this.leasesByMode.set(normalizedModeId, lease);
        for (const resource of resources) this.resourceOwners.set(resource, lease.leaseId);
        const snapshot = this.#leaseSnapshot(lease);
        this.#notify({ type: 'acquired', lease: snapshot });
        return Result.ok(snapshot);
    }

    pause(modeId, leaseOrId) {
        return this.#transition(modeId, leaseOrId, PAUSED);
    }

    resume(modeId, leaseOrId) {
        return this.#transition(modeId, leaseOrId, ACTIVE);
    }

    release(modeId, leaseOrId) {
        const normalizedModeId = this.#modeId(modeId);
        const lease = this.leasesByMode.get(normalizedModeId);
        if (!lease) return Result.ok(null, { alreadyReleased: true });
        const leaseId = this.#leaseId(leaseOrId);
        if (!leaseId || lease.leaseId !== leaseId) {
            return Result.fail(Status.INVALID_INPUT, 'Stale mode lease cannot release the current lease.', null, {
                botId: this.botId,
                modeId: normalizedModeId,
                currentLeaseId: lease.leaseId,
                providedLeaseId: leaseId
            });
        }
        this.leasesByMode.delete(normalizedModeId);
        for (const resource of lease.requestedResources) {
            if (this.resourceOwners.get(resource) === lease.leaseId) this.resourceOwners.delete(resource);
        }
        const snapshot = this.#leaseSnapshot(lease);
        this.#notify({ type: 'released', lease: snapshot });
        return Result.ok(snapshot);
    }

    isHeldBy(modeId, leaseOrId, resource = PRIMARY_RESOURCE) {
        const normalizedModeId = String(modeId || '').trim();
        const leaseId = this.#leaseId(leaseOrId);
        if (!normalizedModeId || !leaseId) return false;
        const lease = this.leasesByMode.get(normalizedModeId);
        return Boolean(
            lease
            && lease.leaseId === leaseId
            && lease.requestedResources.includes(resource)
            && this.resourceOwners.get(resource) === leaseId
        );
    }

    owner(resource = PRIMARY_RESOURCE) {
        const leaseId = this.resourceOwners.get(String(resource || '').trim());
        const lease = leaseId ? this.#leaseById(leaseId) : null;
        return lease ? this.#leaseSnapshot(lease) : null;
    }

    status(modeId) {
        const normalizedModeId = String(modeId || '').trim();
        const lease = normalizedModeId ? this.leasesByMode.get(normalizedModeId) : null;
        return lease ? this.#leaseSnapshot(lease) : null;
    }

    snapshot() {
        const leases = [...this.leasesByMode.values()]
            .map(lease => this.#leaseSnapshot(lease))
            .sort((left, right) => left.modeId.localeCompare(right.modeId));
        return immutableClone({
            botId: this.botId,
            lifecycleState: this.lifecycleState,
            primaryOwner: this.owner(PRIMARY_RESOURCE),
            leases
        });
    }

    onChange(listener) {
        if (typeof listener !== 'function') throw new TypeError('ModeCoordinator change listener must be a function.');
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async stop() {
        if (this.lifecycleState === 'DESTROYED') return;
        const leases = [...this.leasesByMode.values()];
        this.leasesByMode.clear();
        this.resourceOwners.clear();
        for (const lease of leases) this.#notify({ type: 'released', lease: this.#leaseSnapshot(lease), reason: 'coordinator-stop' });
        this.lifecycleState = 'STOPPED';
    }

    async destroy() {
        if (this.lifecycleState === 'DESTROYED') return;
        await this.stop();
        this.listeners.clear();
        this.lifecycleState = 'DESTROYED';
    }

    #transition(modeId, leaseOrId, nextState) {
        const normalizedModeId = this.#modeId(modeId);
        const lease = this.leasesByMode.get(normalizedModeId);
        const leaseId = this.#leaseId(leaseOrId);
        if (!lease || !leaseId || lease.leaseId !== leaseId) {
            return Result.fail(Status.BUSY, 'Mode lease is missing or stale.', null, {
                botId: this.botId,
                modeId: normalizedModeId,
                owner: this.owner()
            });
        }
        if (lease.state === nextState) {
            return Result.ok(this.#leaseSnapshot(lease), {
                [nextState === PAUSED ? 'alreadyPaused' : 'alreadyActive']: true
            });
        }
        lease.state = nextState;
        lease.updatedAt = this.#timestamp();
        const snapshot = this.#leaseSnapshot(lease);
        this.#notify({ type: nextState === PAUSED ? 'paused' : 'resumed', lease: snapshot });
        return Result.ok(snapshot);
    }

    #notify(change) {
        const immutableChange = immutableClone({ botId: this.botId, at: this.#timestamp(), ...change });
        for (const listener of [...this.listeners]) {
            try {
                listener(immutableChange);
            } catch (error) {
                this.logger?.warn?.('ModeCoordinator change listener failed.', {
                    botId: this.botId,
                    type: change.type,
                    error: Redactor.sanitize(error)
                });
            }
        }
    }

    #leaseById(leaseId) {
        for (const lease of this.leasesByMode.values()) {
            if (lease.leaseId === leaseId) return lease;
        }
        return null;
    }

    #leaseSnapshot(lease) {
        return immutableClone({
            leaseId: lease.leaseId,
            botId: lease.botId,
            modeId: lease.modeId,
            acquiredAt: lease.acquiredAt,
            updatedAt: lease.updatedAt,
            state: lease.state,
            requestedResources: lease.requestedResources,
            reason: lease.reason,
            metadata: lease.metadata
        });
    }

    #modeId(value) {
        const modeId = String(value || '').trim();
        if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(modeId)) throw new TypeError('ModeCoordinator modeId is invalid.');
        return modeId;
    }

    #resources(values) {
        if (!Array.isArray(values) || values.length === 0) throw new TypeError('ModeCoordinator requestedResources must be a non-empty array.');
        const resources = [...new Set(values.map(value => String(value || '').trim()))].sort();
        if (resources.some(value => !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(value))) {
            throw new TypeError('ModeCoordinator resource claim is invalid.');
        }
        return Object.freeze(resources);
    }

    #sameResources(left, right) {
        return left.length === right.length && left.every((value, index) => value === right[index]);
    }

    #leaseId(value) {
        if (typeof value === 'string') return value;
        return typeof value?.leaseId === 'string' ? value.leaseId : null;
    }

    #timestamp() {
        const date = new Date(this.clock());
        if (!Number.isFinite(date.getTime())) throw new Error('ModeCoordinator clock returned an invalid time.');
        return date.toISOString();
    }
}

ModeCoordinator.PRIMARY_RESOURCE = PRIMARY_RESOURCE;
ModeCoordinator.STATE = Object.freeze({ ACTIVE, PAUSED });

module.exports = ModeCoordinator;
