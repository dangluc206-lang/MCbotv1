'use strict';

const FlowError = require('../../shared/errors/FlowError');

class FishingPositionGuard {
    constructor({ positionService, connectionState, config = {} }) {
        if (!positionService || !connectionState) throw new TypeError('FishingPositionGuard dependencies are required');
        Object.assign(this, { positionService, connectionState });
        this.anchor = null;
        this.reconfigure(config);
    }

    reconfigure(config = {}) {
        const guard = config.positionGuard || config;
        this.config = Object.freeze({
            radius: this.#positive(guard.radius ?? config.movement?.arrivalRadius, 1),
            verticalTolerance: this.#positive(guard.verticalTolerance ?? config.movement?.verticalTolerance, 1.5)
        });
    }

    current() {
        const position = this.positionService.current();
        return this.#snapshot(position);
    }

    capture({ expectedGeneration = this.connectionState.generation(), position = null } = {}) {
        if (!this.connectionState.isCurrentGeneration(expectedGeneration)) {
            throw this.#error('FISHING_STALE_GENERATION', 'Cannot capture fishing anchor from a stale connection generation.');
        }
        const current = this.#snapshot(position || this.positionService.current());
        if (!this.#finite(current)) throw this.#error('FISHING_POSITION_UNAVAILABLE', 'Fishing anchor position is unavailable.');
        this.anchor = Object.freeze({ ...current, connectionGeneration: Number(expectedGeneration) });
        return this.snapshot();
    }

    invalidate() {
        this.anchor = null;
    }

    snapshot() {
        return this.anchor ? Object.freeze({ ...this.anchor }) : null;
    }

    verifyCurrent({ radius = this.config.radius, verticalTolerance = this.config.verticalTolerance } = {}) {
        if (!this.anchor) return Object.freeze({ valid: false, code: 'FISHING_ANCHOR_UNAVAILABLE' });
        if (!this.connectionState.isCurrentGeneration(this.anchor.connectionGeneration)) {
            return Object.freeze({ valid: false, code: 'FISHING_STALE_GENERATION' });
        }
        const current = this.#snapshot(this.positionService.current());
        if (!this.#finite(current)) return Object.freeze({ valid: false, code: 'FISHING_POSITION_UNAVAILABLE' });
        const horizontal = Math.hypot(current.x - this.anchor.x, current.z - this.anchor.z);
        const vertical = Math.abs(current.y - this.anchor.y);
        if (horizontal > Number(radius)) {
            return Object.freeze({ valid: false, code: 'FISHING_HORIZONTAL_DRIFT', horizontal, vertical, current, anchor: this.snapshot() });
        }
        if (vertical > Number(verticalTolerance)) {
            return Object.freeze({ valid: false, code: 'FISHING_VERTICAL_DRIFT', horizontal, vertical, current, anchor: this.snapshot() });
        }
        return Object.freeze({ valid: true, code: 'OK', horizontal, vertical, current, anchor: this.snapshot() });
    }

    verifyDestination(destination, { radius = this.config.radius, verticalTolerance = this.config.verticalTolerance } = {}) {
        const current = this.#snapshot(this.positionService.current());
        const target = this.#snapshot(destination);
        if (!this.#finite(current) || !this.#finite(target)) return Object.freeze({ valid: false, code: 'FISHING_POSITION_UNAVAILABLE' });
        const horizontal = Math.hypot(current.x - target.x, current.z - target.z);
        const vertical = Math.abs(current.y - target.y);
        if (horizontal > Number(radius)) return Object.freeze({ valid: false, code: 'FISHING_DESTINATION_NOT_REACHED', horizontal, vertical });
        if (vertical > Number(verticalTolerance)) return Object.freeze({ valid: false, code: 'FISHING_DESTINATION_VERTICAL_DRIFT', horizontal, vertical });
        return Object.freeze({ valid: true, code: 'OK', horizontal, vertical, current, destination: target });
    }

    #snapshot(position) {
        if (!position) return null;
        return Object.freeze({ x: Number(position.x), y: Number(position.y), z: Number(position.z) });
    }

    #finite(position) {
        return Boolean(position && ['x', 'y', 'z'].every(axis => Number.isFinite(position[axis])));
    }

    #positive(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : fallback;
    }

    #error(code, message) {
        return new FlowError(message, {
            code,
            subsystem: 'fishing-position',
            operation: 'FishingPositionGuard',
            step: 'capture',
            retryable: true
        });
    }
}

module.exports = FishingPositionGuard;