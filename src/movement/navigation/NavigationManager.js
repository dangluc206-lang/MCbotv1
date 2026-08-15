'use strict';

class NavigationManager {
    constructor({ destinationResolver, routeExecutor, state }) {
        Object.assign(this, { destinationResolver, routeExecutor, state });
    }

    async goTo(destination, options = {}) {
        const resolved = this.destinationResolver.resolve(destination);
        this.state.patch({ moving: true, destination: resolved });
        try {
            return await this.routeExecutor.goTo(resolved, options);
        } finally {
            this.state.patch({ moving: false, destination: null });
        }
    }

    async stop() {
        // Preserve the old V1 MovementService.stop() contract: stopping movement
        // must cancel the actual pathfinder goal, not only clear bookkeeping state.
        // RouteExecutor.stop() calls bot.pathfinder.stop(), which prevents an old
        // pathfinder task from fighting manual fishing controls.
        try {
            await this.routeExecutor?.stop?.();
        } finally {
            this.state.patch({ moving: false, destination: null });
        }
    }
}

module.exports = NavigationManager;
