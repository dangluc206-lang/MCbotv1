'use strict';
const { EventEmitter } = require('node:events');
class EventBus {
    constructor() { this.emitter = new EventEmitter(); }
    on(event, listener) { this.emitter.on(event, listener); return () => this.off(event, listener); }
    once(event, listener) { this.emitter.once(event, listener); return () => this.off(event, listener); }
    off(event, listener) { this.emitter.off(event, listener); }
    emit(event, payload) { return this.emitter.emit(event, payload); }
    removeAll(event) { this.emitter.removeAllListeners(event); }
    listenerCount(event) { return this.emitter.listenerCount(event); }
}
module.exports = EventBus;
