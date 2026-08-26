'use strict';

const CustomModeStore = require('../../modes/composable/CustomModeStore');
const WorkflowDefinitionValidator = require('../../modes/composable/WorkflowDefinitionValidator');
const WorkflowDryRunService = require('../../modes/composable/WorkflowDryRunService');
const CustomModePackageService = require('../../modes/composable/CustomModePackageService');
const CustomModeTemplateGallery = require('../../modes/composable/CustomModeTemplateGallery');
const ModePresentationService = require('../../modes/ModePresentationService');

class CustomModeUseCases {
    constructor({ baseDir, mutationCoordinator = () => null, modeCatalog = () => null } = {}) {
        Object.assign(this, { baseDir, mutationCoordinator, modeCatalog });
    }
    modules() { return new WorkflowDefinitionValidator().moduleCatalog(); }
    templates() { return new CustomModeTemplateGallery().list(); }
    dryRun(definition, simulation) { return new WorkflowDryRunService().simulate(definition, simulation); }
    package(definition) { return new CustomModePackageService().build(definition); }
    presentations() { return new ModePresentationService({ catalog:this.modeCatalog() }).list(); }
    list() { return this.#store().list(); }
    save(definition, options = {}) { return this.#store().save(definition, { expectedDigest:options.expectedDigest || null }); }
    remove(modeId) { return this.#store().remove(modeId); }
    #store() { return new CustomModeStore({ baseDir:this.baseDir, mutationCoordinator:this.mutationCoordinator() }); }
}

module.exports = CustomModeUseCases;
