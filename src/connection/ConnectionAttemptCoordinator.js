'use strict';

const Timeout = require('../shared/time/Timeout');

class ConnectionAttemptCoordinator {
    constructor({
        minSpacingMs = 10000,
        postSuccessSpacingMs = null,
        transientFailureCooldownMs = 15000,
        connectionResetCooldownMs = 20000,
        lostConnectionCooldownMs = 20000,
        loginTooFastCooldownMs = 30000,
        logger = null
    } = {}) {
        this.minSpacingMs = this.#ms(minSpacingMs, 10000);
        this.postSuccessSpacingMs = this.#ms(postSuccessSpacingMs, this.minSpacingMs);
        this.transientFailureCooldownMs = this.#ms(transientFailureCooldownMs, 15000);
        this.connectionResetCooldownMs = this.#ms(connectionResetCooldownMs, 20000);
        this.lostConnectionCooldownMs = this.#ms(lostConnectionCooldownMs, 20000);
        this.loginTooFastCooldownMs = this.#ms(loginTooFastCooldownMs, 30000);
        this.logger = logger;

        this.tail = Promise.resolve();
        this.nextAllowedAt = 0;
        this.sequence = 0;
        this.inFlightBotId = null;
    }

    cooldownForFailure(failureClass = null) {
        switch (String(failureClass || '').toLowerCase()) {
            case 'login-too-fast': return this.loginTooFastCooldownMs;
            case 'connection-reset': return this.connectionResetCooldownMs;
            case 'lost-connection': return this.lostConnectionCooldownMs;
            case 'pre-spawn-disconnect': return this.transientFailureCooldownMs;
            default: return this.transientFailureCooldownMs;
        }
    }

    async acquireTurn({ botId = null, host = null, port = null } = {}) {
        const ticket = ++this.sequence;
        let releaseGate;
        const released = new Promise(resolve => { releaseGate = resolve; });
        let waitMs = 0;
        let releasedOnce = false;

        const prior = this.tail;
        const turn = prior.then(async () => {
            const startedWaitingAt = Date.now();
            // Re-check the deadline after every wait. A bot that fails while the
            // next bot is queued may extend nextAllowedAt (e.g. login-too-fast).
            while (true) {
                const remaining = Math.max(0, this.nextAllowedAt - Date.now());
                if (remaining <= 0) break;
                this.logger?.debug?.('Minecraft connection attempt queued behind global login gate.', {
                    botId,
                    operation: 'ConnectionAttemptCoordinator',
                    step: 'acquire-turn',
                    host,
                    port,
                    waitMs: remaining,
                    ticket,
                    inFlightBotId: this.inFlightBotId
                });
                await Timeout.delay(remaining);
            }
            waitMs = Date.now() - startedWaitingAt;
            this.inFlightBotId = botId;
        });

        // Hold the queue until the whole login/spawn handshake finishes, not just
        // until it starts. This prevents two Mineflayer clients authenticating at once.
        this.tail = turn.then(() => released).catch(() => released);
        await turn;

        const release = ({ outcome = 'success', failureClass = null, cooldownMs = null } = {}) => {
            if (releasedOnce) return false;
            releasedOnce = true;
            const floor = outcome === 'success'
                ? this.postSuccessSpacingMs
                : (cooldownMs !== null && cooldownMs !== undefined && Number.isFinite(Number(cooldownMs))
                    ? Math.max(0, Number(cooldownMs))
                    : this.cooldownForFailure(failureClass));
            this.nextAllowedAt = Math.max(this.nextAllowedAt, Date.now() + floor);
            this.inFlightBotId = null;
            this.logger?.debug?.('Minecraft connection login gate released.', {
                botId,
                operation: 'ConnectionAttemptCoordinator',
                step: 'release-turn',
                ticket,
                outcome,
                failureClass,
                cooldownMs: floor,
                nextAllowedAt: new Date(this.nextAllowedAt).toISOString()
            });
            releaseGate();
            return true;
        };

        return { ticket, waitMs, minSpacingMs: this.minSpacingMs, release };
    }

    // Backward-compatible helper for callers/tests that only need start spacing.
    async waitTurn(args = {}) {
        const lease = await this.acquireTurn(args);
        lease.release({ outcome: 'success', cooldownMs: this.minSpacingMs });
        return lease;
    }

    #ms(value, fallback) {
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? number : fallback;
    }
}

module.exports = ConnectionAttemptCoordinator;
