'use strict';

class ModePresentationService {
    constructor({ catalog } = {}) {
        if (!catalog?.list) throw new TypeError('ModePresentationService catalog is required.');
        this.catalog = catalog;
    }
    list() {
        return this.catalog.list().map(mode => ({
            contract:'mode-presentation-v1', id:mode.id, label:mode.label,
            description:mode.description || '', kind:mode.metadata?.kind || 'built-in',
            primary:mode.primary, durable:mode.durable,
            requiredCapabilities:[...mode.requiredCapabilities], requestedResources:[...mode.requestedResources],
            controls:{ enable:true, pause:true, resume:true, disable:true },
            statusFields:Array.isArray(mode.metadata?.presentation?.statusFields) ? [...mode.metadata.presentation.statusFields] : ['phase','lastError']
        }));
    }
}

module.exports = ModePresentationService;
