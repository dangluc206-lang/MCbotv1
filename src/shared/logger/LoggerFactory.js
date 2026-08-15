'use strict';
const Logger = require('./Logger');
class LoggerFactory {
    constructor({ minimumLevel = 'info', output = null } = {}) { this.minimumLevel = minimumLevel; this.output = output; }
    create(scope) { return new Logger({ scope, minimumLevel: this.minimumLevel, output: this.output }); }
    withMinimumLevel(minimumLevel) { return new LoggerFactory({ minimumLevel, output: this.output }); }
}
module.exports = LoggerFactory;
