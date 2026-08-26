'use strict';

class CapabilityInstaller {
    constructor({ registry } = {}) {
        if (!registry?.register || !registry?.seal) throw new TypeError('CapabilityInstaller registry is required.');
        this.registry = registry;
    }

    install(providers = {}, references = {}) {
        for (const [capabilityId, provider] of Object.entries(providers)) {
            if (!provider) continue;
            this.registry.register(capabilityId, provider, references[capabilityId] || {});
        }
        this.registry.seal();
        return this.registry;
    }
}

module.exports = CapabilityInstaller;
