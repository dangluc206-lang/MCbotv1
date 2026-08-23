'use strict';
const Redactor = require('../security/Redactor');
const VietnamTime = require('../time/VietnamTime');
const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
class Logger {
    constructor({ scope, minimumLevel = 'info', output = null } = {}) {
        if (typeof scope !== 'string' || !scope.trim()) throw new TypeError('scope must be a non-empty string');
        if (!(minimumLevel in LEVELS)) throw new TypeError(`Unknown log level: ${minimumLevel}`);
        this.scope = scope.trim(); this.minimumLevel = minimumLevel;
        this.output = output || ((record) => (console[record.level] || console.log)(JSON.stringify(record)));
    }
    debug(message, meta) { return this.#write('debug', message, meta); }
    info(message, meta) { return this.#write('info', message, meta); }
    warn(message, meta) { return this.#write('warn', message, meta); }
    error(message, meta) { return this.#write('error', message, meta); }
    #write(level, message, meta = null) {
        if (LEVELS[level] < LEVELS[this.minimumLevel]) return null;
        const record = Object.freeze({
            timestamp: VietnamTime.iso(),
            level,
            scope: this.scope,
            message: Redactor.redactText(message),
            meta: Redactor.sanitize(meta)
        });
        this.output(record); return record;
    }
}
Logger.LEVELS = LEVELS;
module.exports = Logger;
