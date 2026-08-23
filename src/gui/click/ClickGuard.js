'use strict';

const FlowError = require('../../shared/errors/FlowError');

class ClickGuard {
    constructor({ context, slotValidator }) { this.context = context; this.slotValidator = slotValidator; }

    assert({ session, slot, expectedGeneration = session?.connectionGeneration, capturedClient = session?.client || null }) {
        session.assertActive();
        const bot = this.context.require();
        const currentGeneration = Number(this.context.getGeneration());
        if (capturedClient && bot !== capturedClient) throw this.#staleGeneration(session, expectedGeneration, currentGeneration, 'client-replaced');
        if (Number(session.connectionGeneration) !== currentGeneration || Number(expectedGeneration) !== currentGeneration) {
            throw this.#staleGeneration(session, expectedGeneration, currentGeneration, 'generation-changed');
        }
        if (session.client && session.client !== bot) throw this.#staleGeneration(session, expectedGeneration, currentGeneration, 'session-client-replaced');
        if (bot.currentWindow !== session.window) {
            throw new FlowError('GUI window changed before click.', {
                code: 'GUI_CLICK_STALE_WINDOW', subsystem: 'gui', operation: 'ClickGuard', step: 'guard-click', retryable: true,
                details: { expectedGeneration: Number(expectedGeneration), currentGeneration, sessionId: session?.id || null }
            });
        }
        if (!this.slotValidator.validate(session.window, slot)) throw new RangeError(`Invalid slot: ${slot}`);
        return true;
    }

    #staleGeneration(session, expectedGeneration, currentGeneration, reason) {
        return new FlowError('GUI client changed before click.', {
            code: 'GUI_CLICK_STALE_GENERATION', subsystem: 'gui', operation: 'ClickGuard', step: 'guard-click', retryable: true,
            details: {
                expectedGeneration: Number(expectedGeneration),
                sessionGeneration: Number(session?.connectionGeneration),
                currentGeneration,
                reason
            }
        });
    }
}

module.exports = ClickGuard;
