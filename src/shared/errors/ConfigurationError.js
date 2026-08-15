'use strict';
const AppError = require('./AppError');
class ConfigurationError extends AppError {
    constructor(message, options = {}) {
        super(message, { ...options, code: options.code || 'CONFIGURATION_ERROR', name: 'ConfigurationError' });
    }
}
module.exports = ConfigurationError;
