'use strict';

const Timeout = require('../../shared/time/Timeout');
const FlowError = require('../../shared/errors/FlowError');

class RouteExecutor {
    constructor({ context, arrivalDetector }) {
        this.context = context;
        this.arrivalDetector = arrivalDetector;
    }

    stop() {
        const bot = this.context.get?.();
        bot?.pathfinder?.stop?.();
    }

    async goTo(destination, { timeoutMs = 30000, radius = 1.5, cancellationToken = null } = {}) {
        const bot = this.context.require();
        const start = bot.entity?.position
            ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z }
            : null;
        if (!bot.pathfinder?.goto) {
            throw new FlowError('mineflayer-pathfinder is not loaded.', {
                code: 'PATHFINDER_NOT_READY', subsystem: 'movement', operation: 'RouteExecutor',
                step: 'prepare-navigation', action: 'resolve pathfinder', resource: 'mineflayer-pathfinder',
                retryable: true, details: { start, destination, radius }
            });
        }
        let GoalNear;
        try {
            ({ goals: { GoalNear } } = require('mineflayer-pathfinder'));
        } catch (error) {
            throw FlowError.wrap(error, {
                code: 'PATHFINDER_NOT_INSTALLED', subsystem: 'movement', operation: 'RouteExecutor',
                step: 'prepare-navigation', action: 'load mineflayer-pathfinder', resource: 'mineflayer-pathfinder',
                retryable: false, details: { start, destination, radius }
            });
        }

        try {
            await Timeout.withTimeout(
                bot.pathfinder.goto(new GoalNear(destination.x, destination.y, destination.z, radius)),
                timeoutMs,
                { cancellationToken, message: 'Navigation timed out.' }
            );
        } catch (error) {
            throw FlowError.wrap(error, {
                code: error?.code === 'TIMEOUT' ? 'NAVIGATION_TIMEOUT' : 'NAVIGATION_FAILED',
                subsystem: 'movement', operation: 'RouteExecutor', step: 'navigate', action: 'pathfinder.goto',
                resource: `${destination.x},${destination.y},${destination.z}`,
                details: { start, destination, radius, timeoutMs }
            });
        }

        if (!this.arrivalDetector.arrived(destination, radius + 0.5)) {
            const current = bot.entity?.position
                ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z }
                : null;
            throw new FlowError('Arrival verification failed.', {
                code: 'NAVIGATION_ARRIVAL_VERIFY_FAILED', subsystem: 'movement', operation: 'RouteExecutor',
                step: 'verify-arrival', action: 'check final distance', resource: `${destination.x},${destination.y},${destination.z}`,
                details: { start, current, destination, radius }
            });
        }
        return destination;
    }
}

module.exports = RouteExecutor;
