'use strict';

const ServerProfileReadinessError = require('./ServerProfileReadinessError');

class ServerProfileRegistry {
    constructor() { this.profiles = new Map(); this.sealed = false; }
    register(profile) {
        if (this.sealed) throw new Error('ServerProfileRegistry is sealed');
        if (!profile?.id || !profile?.revision || !profile?.endpoint) throw new TypeError('A valid ServerProfile is required');
        if (this.profiles.has(profile.id)) throw new Error(`Duplicate server profile: ${profile.id}`);
        this.profiles.set(profile.id, profile);
        return profile;
    }
    seal() { this.sealed = true; return this; }
    get(profileId) { return this.profiles.get(String(profileId || '')) || null; }
    require(profileId) {
        const profile = this.get(profileId);
        if (profile) return profile;
        throw new ServerProfileReadinessError(`Server profile not found: ${String(profileId || '<missing>')}`, {
            profileId: String(profileId || '') || null,
            missing: 'profile'
        });
    }
    list() { return Object.freeze([...this.profiles.values()].map(profile => profile.descriptor())); }
}
module.exports = ServerProfileRegistry;
