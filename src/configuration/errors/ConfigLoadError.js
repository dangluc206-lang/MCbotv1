'use strict';
const ConfigurationError = require('../../shared/errors/ConfigurationError');
class ConfigLoadError extends ConfigurationError {
    constructor(message, { code='CONFIG_READ_FAILED', filePath=null, cause=null, details=null }={}) {
        super(message, { code, cause, details:{ filePath, ...(details||{}) } });
        this.name='ConfigLoadError'; this.filePath=filePath;
    }
    static notFound(filePath,cause){return new ConfigLoadError(`Configuration file not found: ${filePath}`,{code:'CONFIG_FILE_NOT_FOUND',filePath,cause});}
    static invalidJson(filePath,cause){return new ConfigLoadError(`Invalid JSON in configuration file: ${filePath}`,{code:'CONFIG_INVALID_JSON',filePath,cause});}
    static readFailed(filePath,cause){return new ConfigLoadError(`Failed to read configuration file: ${filePath}`,{code:'CONFIG_READ_FAILED',filePath,cause});}
}
module.exports=ConfigLoadError;
