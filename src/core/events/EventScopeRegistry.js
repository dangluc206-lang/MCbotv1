'use strict';

const DEFAULT_CONNECTION_SCOPED_EVENTS = Object.freeze([
    'connection:client-attached',
    'connection:login',
    'connection:spawned',
    'connection:kicked',
    'connection:error',
    'connection:failed',
    'connection:ended',
    'command:message',
    'inventory:observed',
    'inventory:delta',
    'server-login:disabled',
    'server-login:started',
    'server-login:succeeded',
    'server-login:failed',
    'resource-pack:disabled',
    'resource-pack:requested',
    'resource-pack:accepted',
    'resource-pack:ready',
    'resource-pack:failed',
    'movement:position',
    'movement:teleport',
    'player:death',
    'gui:opened',
    'gui:updated',
    'gui:closed',
    'fishing:packet-observation',
    'mode:fishing:catch',
    'skyblock:gateway:scheduled',
    'skyblock:gateway:attempting',
    'skyblock:gateway:succeeded',
    'skyblock:gateway:failed',
]);

const DEFAULT_BOT_SCOPE_OVERRIDE_EVENTS = Object.freeze(['connection:ended']);

class ScopeRegistry {
    constructor({ connectionScopedEvents = DEFAULT_CONNECTION_SCOPED_EVENTS, botScopeOverrideEvents = DEFAULT_BOT_SCOPE_OVERRIDE_EVENTS } = {}) {
        this.connectionScopedEvents = new Set(connectionScopedEvents);
        this.botScopeOverrideEvents = new Set(botScopeOverrideEvents);
    }

    register(eventType, scope = 'bot', { allowBotOverride = false } = {}) {
        const event = this.#event(eventType);
        if (!['bot', 'connection'].includes(scope)) throw new TypeError(`Unsupported event scope: ${scope}`);
        if (scope === 'connection') this.connectionScopedEvents.add(event);
        else this.connectionScopedEvents.delete(event);
        if (allowBotOverride) this.botScopeOverrideEvents.add(event);
        else if (scope !== 'connection') this.botScopeOverrideEvents.delete(event);
        return this;
    }

    scopeFor(eventType) {
        return this.connectionScopedEvents.has(eventType) ? 'connection' : 'bot';
    }

    resolveScope(eventType, requestedScope = null) {
        const canonical = this.scopeFor(eventType);
        if (requestedScope == null || requestedScope === canonical) return canonical;
        if (requestedScope === 'bot' && this.botScopeOverrideEvents.has(eventType)) return 'bot';
        return null;
    }

    isConnectionScoped(eventType) {
        return this.connectionScopedEvents.has(eventType);
    }

    snapshot() {
        return Object.freeze({
            connectionScopedEvents: Object.freeze([...this.connectionScopedEvents].sort()),
            botScopeOverrideEvents: Object.freeze([...this.botScopeOverrideEvents].sort())
        });
    }

    clone() {
        return new ScopeRegistry({
            connectionScopedEvents: this.connectionScopedEvents,
            botScopeOverrideEvents: this.botScopeOverrideEvents
        });
    }

    #event(value) {
        const event = String(value || '').trim();
        if (!event || !/^[a-z0-9][a-z0-9:-]*$/.test(event)) throw new TypeError(`Invalid event type: ${event || '<empty>'}`);
        return event;
    }
}

const defaultRegistry = new ScopeRegistry();

module.exports = Object.freeze({
    create: options => options ? new ScopeRegistry(options) : defaultRegistry.clone(),
    scopeFor: eventType => defaultRegistry.scopeFor(eventType),
    resolveScope: (eventType, requestedScope = null) => defaultRegistry.resolveScope(eventType, requestedScope),
    isConnectionScoped: eventType => defaultRegistry.isConnectionScoped(eventType),
    CONNECTION_SCOPED_EVENTS: DEFAULT_CONNECTION_SCOPED_EVENTS,
    BOT_SCOPE_OVERRIDE_EVENTS: DEFAULT_BOT_SCOPE_OVERRIDE_EVENTS,
    ScopeRegistry
});
