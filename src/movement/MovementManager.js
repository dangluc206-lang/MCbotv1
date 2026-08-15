'use strict';

class MovementManager {
    constructor({ navigationManager, controlStateManager, guard, sprintJumpExecutor = null }) {
        Object.assign(this, { navigationManager, controlStateManager, guard, sprintJumpExecutor });
    }

    async goTo(destination, options = {}) {
        this.guard.assert(typeof destination === 'object' ? destination : { x: 0, y: 0, z: 0 }, options.owner);
        return this.navigationManager.goTo(destination, options);
    }

    async goToSprintJump(destination, options = {}) {
        this.guard.assert(typeof destination === 'object' ? destination : { x: 0, y: 0, z: 0 }, options.owner);
        if (!this.sprintJumpExecutor) throw new Error('Sprint+jump navigation is not configured.');
        return this.sprintJumpExecutor.goTo(destination, options);
    }

    stop() {
        this.controlStateManager.clear();
        return this.navigationManager.stop();
    }

    async destroy() { await this.stop(); }
}

module.exports = MovementManager;
