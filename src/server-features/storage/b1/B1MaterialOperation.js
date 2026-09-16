'use strict';

const Operation = require('../../../operations/Operation');

// Only material-service actions may be wrapped; this keeps the factory from
// becoming an arbitrary-method dispatcher.
const ALLOWED_ACTIONS = Object.freeze(['protectForB5Batch', 'preprocessForCraft']);

/**
 * Builds a managed Operation for one B1 material-service action (protection
 * boundary, pre/post-craft smelting). Mode-agnostic: the service is injected
 * and run-scoped metadata (batchId, episodeId, trigger) stays with the caller
 * via modeContext.run() options, so any mode can run the same material actions
 * without importing a B5 module.
 */
function createB1MaterialOperation({ name, b1Materials, action, args = null } = {}) {
    const operationName = String(name || '').trim();
    if (!operationName) throw new TypeError('B1 material operation name is required.');
    if (!ALLOWED_ACTIONS.includes(action)) {
        throw new TypeError(`B1 material action is not allowed: ${action}.`);
    }
    if (!b1Materials || typeof b1Materials[action] !== 'function') {
        throw new TypeError(`B1 material service with action "${action}" is required.`);
    }
    const extras = args && typeof args === 'object' && !Array.isArray(args) ? { ...args } : null;
    return new Operation({
        name: operationName,
        lockKeys: [],
        returnsResult: true,
        execute: operationContext => b1Materials[action]({
            cancellationToken: operationContext.cancellation.token,
            operationContext,
            expectedGeneration: operationContext.connectionGeneration,
            ...(extras || {})
        })
    });
}

module.exports = { createB1MaterialOperation, ALLOWED_ACTIONS };
