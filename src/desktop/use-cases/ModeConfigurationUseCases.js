'use strict';

const Redactor = require('../../shared/security/Redactor');
const FishingBotConfigEditor = require('../../discord/config/FishingBotConfigEditor');

class ModeConfigurationUseCases {
    constructor({
        baseDir,
        bundleProvider,
        requireRunning,
        FishingEditorClass = FishingBotConfigEditor
    } = {}) {
        if (!baseDir || typeof bundleProvider !== 'function' || typeof requireRunning !== 'function') {
            throw new TypeError('ModeConfigurationUseCases requires baseDir, bundleProvider and requireRunning.');
        }
        Object.assign(this, { baseDir, bundleProvider, requireRunning, FishingEditorClass });
    }

    async fishing(botId) {
        this.requireRunning();
        return Redactor.sanitize(await this.#fishingEditor().read(botId));
    }

    async updateFishingArea(botId, fields = {}) {
        this.requireRunning();
        return Redactor.sanitize(await this.#fishingEditor().setAreaPosition({ botId, ...fields }));
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

