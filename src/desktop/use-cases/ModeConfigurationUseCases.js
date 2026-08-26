'use strict';

const Redactor = require('../../shared/security/Redactor');
const CollectorB5ConfigEditor = require('../../discord/config/CollectorB5ConfigEditor');
const FishingBotConfigEditor = require('../../discord/config/FishingBotConfigEditor');

class ModeConfigurationUseCases {
    constructor({
        baseDir,
        bundleProvider,
        requireRunning,
        CollectorEditorClass = CollectorB5ConfigEditor,
        FishingEditorClass = FishingBotConfigEditor
    } = {}) {
        if (!baseDir || typeof bundleProvider !== 'function' || typeof requireRunning !== 'function') {
            throw new TypeError('ModeConfigurationUseCases requires baseDir, bundleProvider and requireRunning.');
        }
        Object.assign(this, { baseDir, bundleProvider, requireRunning, CollectorEditorClass, FishingEditorClass });
    }

    async collector(botId) {
        this.requireRunning();
        return Redactor.sanitize(await this.#collectorEditor(botId).read());
    }

    async updateCollector(botId, fields = {}) {
        this.requireRunning();
        return Redactor.sanitize(await this.#collectorEditor(botId).update(fields));
    }

    async fishing(botId) {
        this.requireRunning();
        return Redactor.sanitize(await this.#fishingEditor().read(botId));
    }

    async updateFishingArea(botId, fields = {}) {
        this.requireRunning();
        return Redactor.sanitize(await this.#fishingEditor().setAreaPosition({ botId, ...fields }));
    }

    #collectorEditor(botId) {
        const bundle = this.bundleProvider();
        return new this.CollectorEditorClass({
            baseDir: this.baseDir,
            configuration: bundle.configuration,
            botRegistry: bundle.shared.botRegistry,
            botId,
            logger: bundle.shared.loggerFactory.create('DesktopCollectorConfig'),
            mutationCoordinator: bundle.shared.configMutations
        });
    }

    #fishingEditor() {
        const bundle = this.bundleProvider();
        return new this.FishingEditorClass({
            baseDir: this.baseDir,
            configuration: bundle.configuration,
            botRegistry: bundle.shared.botRegistry,
            logger: bundle.shared.loggerFactory.create('DesktopFishingConfig'),
            mutationCoordinator: bundle.shared.configMutations
        });
    }
}

module.exports = ModeConfigurationUseCases;

