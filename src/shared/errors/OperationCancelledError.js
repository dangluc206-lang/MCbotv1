'use strict';
const AppError = require('./AppError');
class OperationCancelledError extends AppError {
    constructor(message = 'Operation cancelled.', options = {}) {
        super(message, { ...options, code: options.code || 'CANCELLED', name: 'OperationCancelledError' });
    }
}
module.exports = OperationCancelledError;
