'use strict';

class CollectorMovementFlow {
    constructor({ island, movementManager, positionService, config }) {
        Object.assign(this, { island, movementManager, positionService, config });
    }

    async returnHome({ cancellationToken = null, expectedGeneration = null } = {}) {
        return this.island.goHome({ cancellationToken, expectedGeneration });
    }

    async moveToPickup(target, { cancellationToken = null } = {}) {
        await this.movementManager.goTo(target, {
            timeoutMs: this.config.moveTimeoutMs,
            radius: this.config.arrivalRadius,
            cancellationToken
        });
        await this.movementManager.stop();
        return { success: true, target };
    }

    needsReanchor(target) {
        const current = this.positionService.current();
        const distance = current ? this.positionService.distance(current, target) : Number.POSITIVE_INFINITY;
        return !Number.isFinite(distance) || distance > this.config.reanchorRadius;
    }
}

module.exports = CollectorMovementFlow;
