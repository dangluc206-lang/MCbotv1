'use strict';

const Timeout = require('../../shared/time/Timeout');
const FlowError = require('../../shared/errors/FlowError');

class RouteExecutor {
    constructor({ context, arrivalDetector }) {
        this.context = context;
        this.arrivalDetector = arrivalDetector;
        this.navigationSequence = 0;
        this.activeNavigation = null;
    }

    stop() {
        const active = this.activeNavigation;
        if (!active) return false;

        this.#stopNavigation(active);
        return true;
    }

    #stopNavigation(navigation) {
        // Do not let completion/timeout from an older route cancel a newer
        // route that has already replaced it.
        if (this.activeNavigation !== navigation) return false;

        // mineflayer-pathfinder's stop() only raises an internal stopPathing
        // flag. Calling it while idle leaves that flag armed and makes the next
        // goto() fail immediately with PathStopped. Only stop a route owned by
        // this executor, and force a null goal so the plugin consumes/clears the
        // flag synchronously instead of poisoning the next navigation.
        const pathfinder = navigation.bot?.pathfinder;
        pathfinder?.stop?.();
        pathfinder?.setGoal?.(null);
        return true;
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

        const navigation = Object.freeze({ id: ++this.navigationSequence, bot });
        this.activeNavigation = navigation;
        try {
            await Timeout.withTimeout(
                bot.pathfinder.goto(new GoalNear(destination.x, destination.y, destination.z, radius)),
                timeoutMs,
                { cancellationToken, message: 'Navigation timed out.' }
            );
        } catch (error) {
            // Timeout.withTimeout settles its wrapper but cannot cancel the
            // underlying pathfinder Promise. Stop the exact owned route before
            // returning a terminal timeout/cancellation to the caller.
            if (error?.code === 'TIMEOUT' || cancellationToken?.isCancelled) {
                this.#stopNavigation(navigation);
            }
            cancellationToken?.throwIfCancelled?.();
            throw FlowError.wrap(error, {
                code: error?.code === 'TIMEOUT' ? 'NAVIGATION_TIMEOUT' : 'NAVIGATION_FAILED',
                subsystem: 'movement', operation: 'RouteExecutor', step: 'navigate', action: 'pathfinder.goto',
                resource: `${destination.x},${destination.y},${destination.z}`,
                details: { start, destination, radius, timeoutMs }
            });
        } finally {
            if (this.activeNavigation === navigation) this.activeNavigation = null;
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
