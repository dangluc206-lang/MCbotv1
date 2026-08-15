'use strict';

class AppError extends Error {
    constructor(message, options = {}) {
        super(String(message || 'Application error'), options.cause ? { cause: options.cause } : undefined);
        this.name = options.name || new.target.name || 'AppError';
        this.code = options.code || 'APP_ERROR';
        this.details = options.details ?? null;
        if (options.cause !== undefined && this.cause === undefined) this.cause = options.cause;
        if (Error.captureStackTrace) Error.captureStackTrace(this, new.target);
    }
}

module.exports = AppError;
