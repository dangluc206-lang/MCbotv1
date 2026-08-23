'use strict';

const FlowError = require('../../shared/errors/FlowError');

class ClickExecutor {
    constructor({ context }) { this.context = context; }

    async click({ slot, button = 0, mode = 0, cancellationToken = null, expectedGeneration = null, capturedClient = null, capturedWindow = null }) {
        cancellationToken?.throwIfCancelled?.();
        const bot = this.context.require();
        const generation = Number(this.context.getGeneration());
        if (expectedGeneration != null && generation !== Number(expectedGeneration)) throw this.#stale(expectedGeneration, generation, bot !== capturedClient);
        if (capturedClient && bot !== capturedClient) throw this.#stale(expectedGeneration, generation, true);
        if (capturedWindow && bot.currentWindow !== capturedWindow) {
            throw new FlowError('GUI window changed before click side effect.', {
                code: 'GUI_CLICK_STALE_WINDOW', subsystem: 'gui', operation: 'ClickExecutor', step: 'before-click', retryable: true
            });
        }
        cancellationToken?.throwIfCancelled?.();
        // No await is allowed between this final guard and clickWindow().
        const pending = bot.clickWindow(slot, button, mode);
        await pending;
        return { slot, button, mode };
    }

    #stale(expectedGeneration, currentGeneration, clientReplaced) {
        return new FlowError('GUI connection changed before click side effect.', {
            code: 'GUI_CLICK_STALE_GENERATION', subsystem: 'gui', operation: 'ClickExecutor', step: 'before-click', retryable: true,
            details: { expectedGeneration, currentGeneration, clientReplaced }
        });
    }
}

module.exports = ClickExecutor;