'use strict';

const { normalizeConnectionGeneration } = require('../../../core/events/EventEnvelope');

function stableItem(normalizer, item, slot = null) {
    if (!item) return null;
    const normalized = normalizer?.normalize?.(item) || item;
    if (!normalized) return null;
    const { raw: _raw, ...stable } = normalized;
    return {
        ...(Number.isInteger(slot) ? { slot } : {}),
        ...stable
    };
}

function mergeIdentityMetadata(target, candidate) {
    if (!target || !candidate) return target;
    const merge = key => {
        const values = [
            ...(Array.isArray(target[key]) ? target[key] : []),
            ...(Array.isArray(candidate[key]) ? candidate[key] : [])
        ].map(String).filter(Boolean);
        target[key] = [...new Set(values)];
    };
    merge('identityComponents');
    merge('identityNbt');
    merge('identityStructuralKeys');
    target.customMetadataPresent = Boolean(target.customMetadataPresent || candidate.customMetadataPresent
        || target.identityComponents?.length || target.identityNbt?.length);
    if ((!target.displayName || target.displayName === target.name) && candidate.displayName) target.displayName = candidate.displayName;
    if ((!Array.isArray(target.lore) || target.lore.length === 0) && Array.isArray(candidate.lore)) target.lore = [...candidate.lore];
    return target;
}

class InventoryObservationService {
    constructor({ botId, context, eventBus, reader, store, normalizer = null, debounceMs = 150, historyLimit = 300, logger = null }) {
        Object.assign(this, { botId, context, eventBus, reader, store, normalizer, logger });
        this.debounceMs = Math.max(25, Number(debounceMs) || 150);
        this.historyLimit = Math.max(50, Number(historyLimit) || 300);
        this.timer = null;
        this.cleanup = [];
        this.inventoryCleanup = null;
        this.windowCleanup = null;
        this.inventoryBinding = null;
        this.windowBinding = null;
        this.latestSnapshot = null;
        this.latestCommittedCaptureId = 0;
        this.captureSequence = 0;
        this.recentEvents = [];
    }

    async initialize() {
        const saved = await this.store.read();
        if (saved) this.latestSnapshot = saved;
        const bot = this.context.get?.();
        const generation = this.#currentGeneration();
        if (bot && generation !== null) {
            this.#bindInventory(bot, generation);
            this.#bindWindow(bot.currentWindow || null, { generation, sessionId: null });
        }
        if (this.eventBus) {
            this.cleanup.push(
                this.eventBus.on('connection:spawned', event => {
                    if (event.botId !== this.botId) return;
                    const eventGeneration = normalizeConnectionGeneration(event);
                    if (!this.#isCurrentGeneration(eventGeneration, true)) return;
                    const current = this.context.get?.();
                    if (!current) return;
                    this.#bindInventory(current, eventGeneration);
                    this.#bindWindow(current.currentWindow || null, { generation: eventGeneration, sessionId: null });
                    this.capture('connection-spawned', { expectedGeneration: eventGeneration }).catch(error => {
                        this.logger?.debug?.('Inventory observation capture after spawn failed.', { error });
                    });
                }),
                this.eventBus.on('connection:ended', event => {
                    if (event.botId !== this.botId) return;
                    const eventGeneration = normalizeConnectionGeneration(event);
                    if (!this.#isCurrentGeneration(eventGeneration, false)) return;
                    this.#unbindInventory();
                    this.#bindWindow(null);
                }),
                this.eventBus.on('gui:opened', event => {
                    if (event.botId !== this.botId) return;
                    const eventGeneration = normalizeConnectionGeneration(event);
                    if (!this.#isCurrentGeneration(eventGeneration, true)) return;
                    this.#bindWindow(this.context.get?.()?.currentWindow || null, {
                        generation: eventGeneration,
                        sessionId: event.sessionId || null
                    });
                    this.schedule('gui-opened', eventGeneration);
                }),
                this.eventBus.on('gui:updated', event => {
                    if (event.botId !== this.botId) return;
                    const eventGeneration = normalizeConnectionGeneration(event);
                    if (!this.#isCurrentGeneration(eventGeneration, true)) return;
                    if (!this.#matchesWindowBinding(eventGeneration, event.sessionId)) return;
                    this.schedule('gui-updated', eventGeneration);
                }),
                this.eventBus.on('gui:closed', event => {
                    if (event.botId !== this.botId) return;
                    const eventGeneration = normalizeConnectionGeneration(event);
                    if (!this.#isCurrentGeneration(eventGeneration, true)) return;
                    if (!this.#matchesWindowBinding(eventGeneration, event.sessionId)) return;
                    this.#bindWindow(null);
                    this.schedule('gui-closed', eventGeneration);
                })
            );
        }
        this.schedule('initialize', generation);
    }

    schedule(reason = 'inventory-update', expectedGeneration = null) {
        if (this.timer) clearTimeout(this.timer);
        const generation = expectedGeneration == null ? null : Number(expectedGeneration);
        this.timer = setTimeout(() => {
            this.timer = null;
            if (generation !== null && !this.#isCurrentGeneration(generation, true)) return;
            this.capture(reason, { expectedGeneration: generation }).catch(error => {
                this.logger?.debug?.('Inventory observation capture failed.', { reason, error });
            });
        }, this.debounceMs);
    }

    async capture(reason = 'manual', { expectedGeneration = null } = {}) {
        const capturedClient = this.context.get?.() || null;
        const capturedGeneration = this.#currentGeneration();
        if (!capturedClient || capturedGeneration === null) return null;
        if (expectedGeneration !== null && expectedGeneration !== undefined
            && Number(expectedGeneration) !== capturedGeneration) return null;
        if (!this.#ownsConnection(capturedClient, capturedGeneration)) return null;

        const captureId = ++this.captureSequence;
        const views = this.reader.readViews();
        if (!this.#ownsConnection(capturedClient, capturedGeneration)) return null;
        const snapshot = {
            botId: this.botId,
            connectionGeneration: capturedGeneration,
            captureId,
            capturedAt: Date.now(),
            reason,
            views: views.map(view => ({
                source: view.source,
                windowId: view.windowId,
                slotCount: view.slotCount,
                emptySlotCount: view.emptySlotCount,
                inventoryStart: view.inventoryStart,
                inventoryEnd: view.inventoryEnd,
                items: view.items
            }))
        };

        // Persistence may be slow. The snapshot keeps its original generation,
        // but it becomes current state only if that exact client/generation still
        // owns the runtime after the write completes.
        await this.store.write(snapshot);
        if (!this.#ownsConnection(capturedClient, capturedGeneration)) return null;
        if (captureId < this.latestCommittedCaptureId) return snapshot;

        this.latestCommittedCaptureId = captureId;
        this.latestSnapshot = snapshot;
        this.eventBus?.emit('inventory:observed', {
            botId: this.botId,
            connectionGeneration: capturedGeneration,
            captureId,
            capturedAt: snapshot.capturedAt,
            sources: snapshot.views.map(view => view.source),
            reason
        });
        return snapshot;
    }

    latest({ maxAgeMs = Infinity, connectionGeneration = null, currentGenerationOnly = false } = {}) {
        if (!this.latestSnapshot) return null;
        if (Date.now() - Number(this.latestSnapshot.capturedAt || 0) > maxAgeMs) return null;
        const requiredGeneration = connectionGeneration == null && currentGenerationOnly
            ? this.#currentGeneration()
            : Number(connectionGeneration);
        if (connectionGeneration != null || currentGenerationOnly) {
            if (!Number.isInteger(requiredGeneration) || requiredGeneration <= 0) return null;
            if (Number(this.latestSnapshot.connectionGeneration) !== requiredGeneration) return null;
        }
        return this.latestSnapshot;
    }

    eventsSince(timestamp = 0, { connectionGeneration = null } = {}) {
        const since = Number(timestamp) || 0;
        const generation = connectionGeneration == null ? null : Number(connectionGeneration);
        return this.recentEvents
            .filter(event => Number(event.at || 0) >= since)
            .filter(event => generation === null || Number(event.connectionGeneration) === generation)
            .map(event => ({ ...event }));
    }

    clearEventsBefore(timestamp = Date.now()) {
        const cutoff = Number(timestamp) || 0;
        this.recentEvents = this.recentEvents.filter(event => Number(event.at || 0) >= cutoff);
    }

    #recordDelta({ capturedClient, generation, source, windowId = null, sessionId = null, slot, oldItem, newItem }) {
        if (!this.#ownsConnection(capturedClient, generation)) return null;
        const event = {
            botId: this.botId,
            connectionGeneration: generation,
            at: Date.now(),
            source,
            windowId,
            sessionId: sessionId || null,
            slot: Number.isInteger(slot) ? slot : null,
            oldItem: stableItem(this.normalizer, oldItem, slot),
            newItem: stableItem(this.normalizer, newItem, slot)
        };
        this.recentEvents.push(event);
        if (this.recentEvents.length > this.historyLimit) {
            this.recentEvents.splice(0, this.recentEvents.length - this.historyLimit);
        }
        this.eventBus?.emit('inventory:delta', event);
        return event;
    }

    #enrichDeltaIdentity(event, candidateItem) {
        if (!event || !candidateItem || !event.newItem) return;
        const candidate = stableItem(this.normalizer, candidateItem, event.slot);
        if (!candidate) return;
        mergeIdentityMetadata(event.newItem, candidate);
    }

    #bindInventory(bot, generation) {
        this.#unbindInventory();
        const inventory = bot?.inventory;
        if (!inventory?.on || !Number.isInteger(generation) || generation <= 0) return;
        const onUpdateSlot = (slot, oldItem, newItem) => {
            if (this.context.get?.() !== bot || this.#currentGeneration() !== generation) return;
            const event = this.#recordDelta({ capturedClient: bot, generation, source: 'bot-inventory', slot, oldItem, newItem });
            if (!event) return;
            this.#enrichDeltaIdentity(event, inventory.slots?.[slot]);
            queueMicrotask(() => {
                if (this.context.get?.() === bot && this.#currentGeneration() === generation) {
                    this.#enrichDeltaIdentity(event, inventory.slots?.[slot]);
                }
            });
            this.schedule('bot-inventory-update', generation);
        };
        inventory.on('updateSlot', onUpdateSlot);
        this.inventoryBinding = { bot, generation };
        this.inventoryCleanup = () => inventory.off?.('updateSlot', onUpdateSlot);
    }

    #unbindInventory() {
        this.inventoryCleanup?.();
        this.inventoryCleanup = null;
        this.inventoryBinding = null;
    }

    #bindWindow(window, { generation = null, sessionId = null } = {}) {
        this.windowCleanup?.();
        this.windowCleanup = null;
        this.windowBinding = null;
        if (!window?.on) return;
        const canonicalGeneration = Number(generation);
        if (!Number.isInteger(canonicalGeneration) || canonicalGeneration <= 0) return;
        const onUpdateSlot = (slot, oldItem, newItem) => {
            if (!this.#isCurrentGeneration(canonicalGeneration, true)) return;
            if (this.context.get?.()?.currentWindow !== window) return;
            const start = Number(window.inventoryStart);
            const end = Number.isInteger(Number(window.inventoryEnd)) ? Number(window.inventoryEnd) : window.slots?.length;
            if (!Number.isInteger(start) || slot < start || (Number.isInteger(end) && slot >= end)) return;
            const capturedClient = this.context.get?.();
            const event = this.#recordDelta({
                capturedClient,
                generation: canonicalGeneration,
                source: 'current-window',
                windowId: window.id ?? null,
                sessionId: this.windowBinding?.sessionId || null,
                slot,
                oldItem,
                newItem
            });
            if (!event) return;
            this.#enrichDeltaIdentity(event, window.slots?.[slot]);
            queueMicrotask(() => {
                if (this.#isCurrentGeneration(canonicalGeneration, true) && this.context.get?.()?.currentWindow === window) {
                    this.#enrichDeltaIdentity(event, window.slots?.[slot]);
                }
            });
            this.schedule('current-window-inventory-update', canonicalGeneration);
        };
        window.on('updateSlot', onUpdateSlot);
        this.windowBinding = { window, generation: canonicalGeneration, sessionId: sessionId || null };
        this.windowCleanup = () => window.off?.('updateSlot', onUpdateSlot);
    }

    #matchesWindowBinding(generation, sessionId) {
        const binding = this.windowBinding;
        if (!binding) return false;
        if (binding.generation !== Number(generation)) return false;
        if (binding.sessionId && sessionId && binding.sessionId !== sessionId) return false;
        return true;
    }

    #ownsConnection(client, generation) {
        return Boolean(client)
            && Number.isInteger(Number(generation))
            && Number(generation) > 0
            && this.context.get?.() === client
            && this.context.has?.()
            && this.#currentGeneration() === Number(generation);
    }

    #currentGeneration() {
        const generation = Number(this.context.getGeneration?.());
        return Number.isInteger(generation) && generation > 0 ? generation : null;
    }

    #isCurrentGeneration(generation, requireConnected) {
        if (!Number.isInteger(generation) || generation <= 0) return false;
        if (this.#currentGeneration() !== generation) return false;
        if (requireConnected && !this.context.has?.()) return false;
        return true;
    }

    async stop() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.#unbindInventory();
        this.#bindWindow(null);
        for (const off of this.cleanup.splice(0)) off();
        await this.store?.drain?.();
    }

    async destroy() { await this.stop(); }
}

module.exports = InventoryObservationService;
