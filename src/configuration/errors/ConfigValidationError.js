'use strict';
const ConfigurationError=require('../../shared/errors/ConfigurationError');
class ConfigValidationError extends ConfigurationError{constructor(schemaName,errors=[],options={}){super(`Configuration validation failed for ${schemaName}.`,{code:'CONFIG_VALIDATION_FAILED',cause:options.cause,details:{schemaName,validationErrors:errors,valuePath:options.valuePath||null}});this.name='ConfigValidationError';this.schemaName=schemaName;this.validationErrors=errors;}}
module.exports=ConfigValidationError;
