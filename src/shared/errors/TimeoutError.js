'use strict';
const AppError = require('./AppError');
class TimeoutError extends AppError {
    constructor(message = 'Operation timed out.', options = {}) {
        super(message, { ...options, code: options.code || 'TIMEOUT', name: 'TimeoutError' });
    }
}
module.exports = TimeoutError;
