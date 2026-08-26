'use strict';

const path = require('node:path');
const DesktopSecretStore = require('../DesktopSecretStore');
const resolveDesktopEnvironment = require('../DesktopEnvironmentResolver');
const RuntimeConfigMigrator = require('../update/RuntimeConfigMigrator');
const DesktopRuntimeProvenanceService = require('../readiness/DesktopRuntimeProvenanceService');

class DesktopRuntimeBootstrap {
    constructor({
        templateRoot,
        userDataRoot,
        isPackaged = false,
        appVersion,
        safeStorage,
        baseEnvironmentProvider = () => process.env,
        RuntimeConfigMigratorClass = RuntimeConfigMigrator,
        DesktopSecretStoreClass = DesktopSecretStore,
        DesktopRuntimeProvenanceServiceClass = DesktopRuntimeProvenanceService,
        environmentResolver = resolveDesktopEnvironment
    } = {}) {
        if (!templateRoot || !userDataRoot || !appVersion || !safeStorage) {
            throw new TypeError('DesktopRuntimeBootstrap requires templateRoot, userDataRoot, appVersion and safeStorage.');
        }
        Object.assign(this, {
            templateRoot: path.resolve(templateRoot),
            userDataRoot: path.resolve(userDataRoot),
            isPackaged: isPackaged === true,
            appVersion: String(appVersion),
            safeStorage,
            baseEnvironmentProvider,
            RuntimeConfigMigratorClass,
            DesktopSecretStoreClass,
            DesktopRuntimeProvenanceServiceClass,
            environmentResolver
        });
        this.runtimeRoot = null;
        this.migrator = null;
        this.migrationReport = null;
        this.secretStore = null;
        this.environmentProvenance = null;
        this.provenanceService = null;
        this.prepared = null;
        this.preparePromise = null;
    }

    async prepare() {
        if (this.prepared) return this.prepared;
        if (this.preparePromise) return this.preparePromise;
        this.preparePromise = this.#prepareInternal();
        try {
            this.prepared = await this.preparePromise;
            return this.prepared;
        } finally {
            this.preparePromise = null;
        }
    }

    async #prepareInternal() {
        this.runtimeRoot = path.join(this.userDataRoot, this.isPackaged ? 'runtime' : 'runtime-dev');
        this.migrator = new this.RuntimeConfigMigratorClass({
            templateRoot: this.templateRoot,
            runtimeRoot: this.runtimeRoot,
            appVersion: this.appVersion
        });
        this.migrationReport = await this.migrator.prepare();
        this.secretStore = new this.DesktopSecretStoreClass({
            filePath: path.join(this.userDataRoot, 'secrets.json'),
            safeStorage: this.safeStorage
        });
        const environment = this.resolveEnvironment();
        this.provenanceService = new this.DesktopRuntimeProvenanceServiceClass({
            templateRoot: this.templateRoot,
            runtimeRoot: this.runtimeRoot,
            isPackaged: this.isPackaged,
            migrationReportProvider: () => this.migrationReport,
            environmentProvenanceProvider: () => this.environmentProvenance
        });
        return Object.freeze({
            runtimeRoot: this.runtimeRoot,
            migrator: this.migrator,
            migrationReport: this.migrationReport,
            secretStore: this.secretStore,
            environment,
            provenanceService: this.provenanceService
        });
    }

    resolveEnvironment() {
        if (!this.secretStore) throw new Error('Desktop runtime bootstrap must prepare the secret store before resolving environment.');
        const resolution = this.environmentResolver({
            templateRoot: this.templateRoot,
            isPackaged: this.isPackaged,
            baseEnvironment: this.baseEnvironmentProvider(),
            secretStore: this.secretStore
        });
        if (!resolution || !resolution.environment || typeof resolution.environment !== 'object' || Array.isArray(resolution.environment)) {
            throw new TypeError('Desktop runtime bootstrap received an invalid environment resolution.');
        }
        this.environmentProvenance = resolution.provenance;
        return Object.freeze({ ...resolution.environment });
    }
}

module.exports = DesktopRuntimeBootstrap;
