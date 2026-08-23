'use strict';

const { EventEmitter } = require('node:events');
const EventEnvelope = require('./events/EventEnvelope');
const EventScopeRegistry = require('./events/EventScopeRegistry');
const SubscriptionBag = require('./events/SubscriptionBag');

const DEFAULT_MAX_LISTENERS = 64;

class EventBus {
    constructor({
        eventFactory = EventEnvelope.createEventEnvelope,
        scopeRegistry = null,
        maxListeners = DEFAULT_MAX_LISTENERS
    } = {}) {
        if (!Number.isInteger(maxListeners) || maxListeners < 1) {
            throw new TypeError('EventBus maxListeners must be a positive integer');
        }
        this.emitter = new EventEmitter();
        this.emitter.setMaxListeners(maxListeners);
        this.eventFactory = eventFactory;
        this.scopeRegistry = scopeRegistry || EventScopeRegistry.create();
        this.maxListeners = maxListeners;
    }

    on(event, listener) { this.emitter.on(event, listener); return () => this.off(event, listener); }
    once(event, listener) { this.emitter.once(event, listener); return () => this.off(event, listener); }
    off(event, listener) { this.emitter.off(event, listener); }

    emit(event, payload, { scope: requestedScope = null } = {}) {
        // Scope is resolved before payload handling. Connection-scoped events are
        // fail-closed even when callers pass null/primitives/arrays/functions, and
        // malformed payloads never reach the event factory or operational listeners.
        const scope = this.scopeRegistry?.resolveScope?.(event, requestedScope)
            ?? (requestedScope == null ? (this.scopeRegistry?.scopeFor?.(event) || 'bot') : null);
        if (!scope) return false;

        const isPlainPayload = payload !== null
            && typeof payload === 'object'
            && !Array.isArray(payload)
            && (Object.getPrototypeOf(payload) === Object.prototype || Object.getPrototypeOf(payload) === null);

        if (scope === 'connection') {
            if (!isPlainPayload) return false;
            const botId = typeof payload.botId === 'string' && payload.botId.trim() ? payload.botId : null;
            const generation = payload.connectionGeneration;
            if (!botId || !Number.isInteger(generation) || generation <= 0) return false;
        }

        // Bot-scoped events historically allowed primitive payloads. Keep that
        // compatibility for external callers while runtime producers use objects.
        if (!isPlainPayload) {
            if (arguments.length < 2) payload = {};
            else return this.emitter.emit(event, payload);
        }

        const enveloped = this.eventFactory(event, payload, { scope });
        return this.emitter.emit(event, enveloped);
    }



    registerEventScope(event, scope = 'bot', options = {}) {
        if (typeof this.scopeRegistry?.register !== 'function') {
            throw new Error('EventBus scope registry is not extensible.');
        }
        this.scopeRegistry.register(event, scope, options);
        return this;
    }

    scopeSnapshot() {
        return this.scopeRegistry?.snapshot?.() || null;
    }

    subscriptions(options = {}) {
        return new SubscriptionBag(options);
    }

    removeAll(event) { this.emitter.removeAllListeners(event); }
    listenerCount(event) { return this.emitter.listenerCount(event); }
}

EventBus.DEFAULT_MAX_LISTENERS = DEFAULT_MAX_LISTENERS;
module.exports = EventBus;
