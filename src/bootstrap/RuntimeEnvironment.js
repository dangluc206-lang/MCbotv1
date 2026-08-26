'use strict';

const path = require('node:path');

const CONTRACT = 'runtime-environment-v1';

function environmentFailure(error) {
    const wrapped = new Error('Runtime environment could not be loaded.');
    wrapped.code = 'ENVIRONMENT_LOAD_FAILED';
    wrapped.cause = error;
    return wrapped;
}

function dotenvConfigProvider(explicitProvider) {
    if (explicitProvider !== undefined) return explicitProvider;
    try {
        return require('dotenv').config;
    } catch (error) {
        if (error?.code === 'MODULE_NOT_FOUND') return null;
        throw error;
    }
}

function resolveRuntimeEnvironment({
    baseDir = process.cwd(),
    baseEnvironment = process.env,
    dotenvConfig,
    loadDotenv = true
} = {}) {
    if (!baseEnvironment || typeof baseEnvironment !== 'object' || Array.isArray(baseEnvironment)) {
        throw new TypeError('baseEnvironment must be an object.');
    }
    const environment = { ...(baseEnvironment || {}) };
    let dotenvState = loadDotenv ? 'UNAVAILABLE' : 'SKIPPED';

    if (loadDotenv) {
        const provider = dotenvConfigProvider(dotenvConfig);
        if (provider) {
            if (typeof provider !== 'function') throw new TypeError('dotenvConfig must be a function when provided.');
            let result;
            try {
                result = provider({
                    path: path.join(path.resolve(baseDir), '.env'),
                    processEnv: environment,
                    override: false,
                    quiet: true
                });
            } catch (error) {
                throw environmentFailure(error);
            }
            if (result?.error && result.error.code !== 'ENOENT') throw environmentFailure(result.error);
            dotenvState = result?.error?.code === 'ENOENT' ? 'MISSING' : 'LOADED';
        }
    }

    return Object.freeze({
        environment: Object.freeze(environment),
        provenance: Object.freeze({
            contract: CONTRACT,
            baseSource: 'PROCESS_ENVIRONMENT',
            dotenvState,
            dotenvPrecedence: 'FILL_MISSING_ONLY',
            secretOverlay: 'NONE'
        })
    });
}

function loadRuntimeEnvironment(options = {}) {
    return resolveRuntimeEnvironment(options).environment;
}

module.exports = loadRuntimeEnvironment;
module.exports.resolveRuntimeEnvironment = resolveRuntimeEnvironment;
module.exports.CONTRACT = CONTRACT;
