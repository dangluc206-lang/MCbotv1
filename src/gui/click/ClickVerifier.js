'use strict';
const TimeoutError=require('../../shared/errors/TimeoutError');

class ClickVerifier {
    constructor({ eventBus }) { this.eventBus = eventBus; }

    verify({ botId, session, timeoutMs = 3000, acceptWindowChange = true }) {
        if (!this.eventBus) return Promise.resolve(true);
        return new Promise((resolve, reject) => {
            let done = false;
            const subscriptions = [];
            const finish = (fn, value) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                for (const off of subscriptions) off();
                fn(value);
            };
            subscriptions.push(this.eventBus.on('gui:updated', event => {
                if (event.botId === botId && event.sessionId === session.id) finish(resolve, true);
            }));
            if (acceptWindowChange) {
                subscriptions.push(this.eventBus.on('gui:opened', event => {
                    if (event.botId === botId) finish(resolve, true);
                }));
                subscriptions.push(this.eventBus.on('gui:closed', event => {
                    if (event.botId === botId && event.sessionId === session.id) finish(resolve, true);
                }));
            }
            const timer = setTimeout(() => finish(reject, new TimeoutError('Click verification timed out.')), timeoutMs);
        });
    }
}

module.exports=ClickVerifier;
