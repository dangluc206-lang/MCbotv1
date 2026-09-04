'use strict';

const CustomModeStore = require('../../modes/composable/CustomModeStore');
const WorkflowDefinitionValidator = require('../../modes/composable/WorkflowDefinitionValidator');
const WorkflowDryRunService = require('../../modes/composable/WorkflowDryRunService');
const CustomModePackageService = require('../../modes/composable/CustomModePackageService');
const CustomModeTemplateGallery = require('../../modes/composable/CustomModeTemplateGallery');
const ModePresentationService = require('../../modes/ModePresentationService');

class CustomModeUseCases {
    constructor({
        baseDir,
        mutationCoordinator = () => null,
        modeCatalog = () => null,
        validator = new WorkflowDefinitionValidator(),
        gallery = null,
        dryRunService = null,
        packageService = null,
        store = null,
        StoreClass = CustomModeStore,
        GalleryClass = CustomModeTemplateGallery,
        DryRunClass = WorkflowDryRunService,
        PackageClass = CustomModePackageService
    } = {}) {
        Object.assign(this, { baseDir, mutationCoordinator, modeCatalog, validator });
        this.gallery = gallery || new GalleryClass({ validator });
        this.dryRunService = dryRunService || new DryRunClass({ validator });
        this.packageService = packageService || new PackageClass({ validator });
        this.store = store || new StoreClass({ baseDir, validator, mutationCoordinator: mutationCoordinator() });
    }
    modules() { return this.validator.moduleCatalog(); }
    templates() { return this.gallery.list(); }
    dryRun(definition, simulation) { return this.dryRunService.simulate(definition, simulation); }
    package(definition) { return this.packageService.build(definition); }
    presentations() { return new ModePresentationService({ catalog:this.modeCatalog() }).list(); }
    list() { return this.store.list(); }
    save(definition, options = {}) { return this.store.save(definition, { expectedDigest:options.expectedDigest || null }); }
    remove(modeId) { return this.store.remove(modeId); }
}

module.exports = CustomModeUseCases;
