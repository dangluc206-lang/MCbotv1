'use strict';

const Redactor = require('../../shared/security/Redactor');

const UPDATE_FIELDS = Object.freeze(['displayName', 'username', 'auth', 'version', 'serverProfile', 'skyblockSelection', 'enabled']);
const CREATE_FIELDS = Object.freeze(['id', 'displayName', 'username', 'auth', 'version', 'serverProfile', 'skyblockSelection']);

function allowlisted(source, fields) {
    const output = {};
    for (const key of fields) {
        if (Object.prototype.hasOwnProperty.call(source || {}, key)) output[key] = source[key];
    }
    return output;
}

class BotProfileUseCases {
    constructor({ bundleProvider, requireRunning } = {}) {
        if (typeof bundleProvider !== 'function' || typeof requireRunning !== 'function') {
            throw new TypeError('BotProfileUseCases requires bundleProvider and requireRunning.');
        }
        this.bundleProvider = bundleProvider;
        this.requireRunning = requireRunning;
    }

    async list() {
        this.requireRunning();
        return (await this.bundleProvider().botProfileAdmin.listProfiles()).map(profile => Redactor.sanitize(profile));
    }

    async update(botId, fields) {
        this.requireRunning();
        return Redactor.sanitize(await this.bundleProvider().botProfileAdmin.updateProfile(botId, allowlisted(fields, UPDATE_FIELDS)));
    }

    async create(fields = {}) {
        this.requireRunning();
        return Redactor.sanitize(await this.bundleProvider().botProfileAdmin.createProfile(allowlisted(fields, CREATE_FIELDS)));
    }

    async clone(botId, newId) {
        this.requireRunning();
        return Redactor.sanitize(await this.bundleProvider().botProfileAdmin.cloneProfile(botId, newId));
    }

    async remove(botId) {
        this.requireRunning();
        return Redactor.sanitize(await this.bundleProvider().botProfileAdmin.deleteProfile(botId));
    }
}

module.exports = BotProfileUseCases;

