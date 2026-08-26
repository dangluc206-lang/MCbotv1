'use strict';

const RuntimeEnvironment = require('../bootstrap/RuntimeEnvironment');

const CONTRACT = 'desktop-environment-v1';

function resolveDesktopEnvironment({
    templateRoot,
    isPackaged = false,
    baseEnvironment = process.env,
    secretStore,
    runtimeEnvironmentResolver = RuntimeEnvironment.resolveRuntimeEnvironment
} = {}) {
    if (!templateRoot) throw new TypeError('Desktop environment templateRoot is required.');
    if (!secretStore || typeof secretStore.environment !== 'function') {
        throw new TypeError('Desktop environment secretStore is required.');
    }

    const runtime = isPackaged
        ? {
            environment: { ...(baseEnvironment || {}) },
            provenance: {
                contract: RuntimeEnvironment.CONTRACT,
                baseSource: 'PROCESS_ENVIRONMENT',
                dotenvState: 'SKIPPED_PACKAGED',
                dotenvPrecedence: 'FILL_MISSING_ONLY',
                secretOverlay: 'NONE'
            }
        }
        : runtimeEnvironmentResolver({ baseDir: templateRoot, baseEnvironment });
    if (!runtime || !runtime.environment || typeof runtime.environment !== 'object' || Array.isArray(runtime.environment)) {
        throw new TypeError('Runtime environment resolver returned an invalid environment.');
    }
    const environment = secretStore.environment(runtime.environment);
    if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
        throw new TypeError('Desktop secret store returned an invalid environment.');
    }

    return Object.freeze({
        environment: Object.freeze({ ...environment }),
        provenance: Object.freeze({
            contract: CONTRACT,
            baseSource: runtime.provenance?.baseSource || 'PROCESS_ENVIRONMENT',
            dotenvState: runtime.provenance?.dotenvState || 'UNKNOWN',
            dotenvPrecedence: runtime.provenance?.dotenvPrecedence || 'FILL_MISSING_ONLY',
            secretOverlay: 'OS_ENCRYPTED_STORE_LAST'
        })
    });
}

module.exports = resolveDesktopEnvironment;
module.exports.CONTRACT = CONTRACT;
