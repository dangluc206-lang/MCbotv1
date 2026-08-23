'use strict';

class CommandGuard {
    constructor({ context, minimumIntervalMs = 250, now = Date.now }) {
        if (typeof now !== 'function') throw new TypeError('now must be a function');
        this.context = context;
        this.minimumIntervalMs = minimumIntervalMs;
        this.now = now;
        this.lastSentAt = null;
    }

    assert(command) {
        this.context.require();
        if (typeof command !== 'string' || !command.startsWith('/')) {
            throw new TypeError('Resolved server command must start with /.');
        }
        if (this.lastSentAt === null) return 0;
        return Math.max(0, this.minimumIntervalMs - (this.now() - this.lastSentAt));
    }

    markSent() {
        this.lastSentAt = this.now();
    }
}

module.exports = CommandGuard;
