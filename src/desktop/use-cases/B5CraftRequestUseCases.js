'use strict';

// Compatibility alias for older Desktop preload/renderer clients.
// Lazily requires the generic use-case at construction time so the compat
// module is required by tests without creating a require cycle with
// CraftingRequestUseCases, while the `mcbot:b5:craft-*` IPC namespace is
// still served.
class B5CraftRequestUseCases {
    constructor(options) {
        const CraftingRequestUseCases = require('./CraftingRequestUseCases');
        const delegate = new CraftingRequestUseCases(options);
        return delegate;
    }
}

/**
 * @deprecated Use CraftingRequestUseCases (generic `crafting` namespace).
 */
module.exports = B5CraftRequestUseCases;

