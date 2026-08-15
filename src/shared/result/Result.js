'use strict';
const Status = require('./Status');
const { immutableClone } = require('../utils/object');

class Result {
    constructor({ status, success, data = null, error = null, message = '', meta = null }) {
        this.status = status;
        this.success = Boolean(success);
        this.data = immutableClone(data);
        this.error = error || null;
        this.message = String(message || '');
        this.meta = immutableClone(meta);
        Object.freeze(this);
    }
    static ok(data = null, meta = null) {
        return new Result({ status: Status.SUCCESS, success: true, data, meta });
    }
    static fail(status = Status.FAILED, message = '', error = null, meta = null) {
        return new Result({ status, success: false, error, message, meta });
    }
    static cancelled(message = 'Operation cancelled.', meta = null) {
        return Result.fail(Status.CANCELLED, message, null, meta);
    }
    static timeout(message = 'Operation timed out.', meta = null) {
        return Result.fail(Status.TIMEOUT, message, null, meta);
    }
}
module.exports = Result;
