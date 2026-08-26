'use strict';

const crypto = require('node:crypto');
const WorkflowDefinitionValidator = require('./WorkflowDefinitionValidator');

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}

class CustomModePackageService {
    constructor({ validator = new WorkflowDefinitionValidator() } = {}) { this.validator = validator; }
    build(definition) {
        const normalized = this.validator.normalize(definition);
        const digest = crypto.createHash('sha256').update(canonical(normalized)).digest('hex');
        return Object.freeze({
            manifest:Object.freeze({ contract:'mcbot-custom-mode-package-v1', schemaVersion:1, modeId:normalized.id, digest:`sha256:${digest}`, requiredCapabilities:[...normalized.requiredCapabilities], requestedResources:[...normalized.requestedResources] }),
            definition:normalized
        });
    }
    verify(pkg) {
        if (pkg?.manifest?.contract !== 'mcbot-custom-mode-package-v1') return { valid:false, errors:['Package contract không hợp lệ.'] };
        try {
            const rebuilt = this.build(pkg.definition);
            const valid = canonical(rebuilt.manifest) === canonical(pkg.manifest);
            return { valid, errors:valid ? [] : ['Package manifest, digest hoặc dependency contract không khớp.'], package:valid ? rebuilt : null };
        } catch (error) { return { valid:false, errors:[error.message], package:null }; }
    }
}

module.exports = CustomModePackageService;
