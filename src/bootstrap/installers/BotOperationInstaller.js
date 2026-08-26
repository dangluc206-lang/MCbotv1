'use strict';

const OperationQueue = require('../../operations/OperationQueue');
const OperationLockPolicy = require('../../operations/OperationLockPolicy');
const OperationTimeoutPolicy = require('../../operations/OperationTimeoutPolicy');
const OperationManager = require('../../operations/OperationManager');

class BotOperationInstaller {
    static install({ botId, appConfig, logger }) {
        const config = appConfig.operations || {};
        const queue = new OperationQueue({ maxPending: config.maxPending ?? 128 });
        const lockPolicy = new OperationLockPolicy();
        const timeoutPolicy = new OperationTimeoutPolicy();
        const operationManager = new OperationManager({ botId, queue, lockPolicy, timeoutPolicy, logger, config });
        return Object.freeze({ operationConfig: config, queue, lockPolicy, timeoutPolicy, operationManager });
    }
}

module.exports = BotOperationInstaller;
