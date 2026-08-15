'use strict';

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
        this.latestSnapshot = null;
        this.recentEvents = [];
    }

    async initialize() {
        const saved = await this.store.read();
        if (saved) this.latestSnapshot = saved;
        const bot = this.context.get?.();
        if (bot) {
            this.#bindInventory(bot);
            this.#bindWindow(bot.currentWindow || null);
        }
        if (this.eventBus) {
            this.cleanup.push(
                this.eventBus.on('connection:spawned', event => {
                    if (event.botId !== this.botId) return;
                    const current = this.context.get?.();
                    if (current) {
                        this.#bindInventory(current);
                        this.#bindWindow(current.currentWindow || null);
                    }
                    this.capture('connection-spawned').catch(() => {});
                }),
                this.eventBus.on('gui:opened', event => {
                    if (event.botId !== this.botId) return;
                    this.#bindWindow(this.context.get?.()?.currentWindow || null);
                    this.schedule('gui-opened');
                }),
                this.eventBus.on('gui:updated', event => {
                    if (event.botId === this.botId) this.schedule('gui-updated');
                }),
                this.eventBus.on('gui:closed', event => {
                    if (event.botId !== this.botId) return;
                    this.#bindWindow(null);
                    this.schedule('gui-closed');
                })
            );
        }
        this.schedule('initialize');
    }

    schedule(reason = 'inventory-update') {
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            this.capture(reason).catch(error => {
                this.logger?.debug?.('Inventory observation capture failed.', { reason, error });
            });
        }, this.debounceMs);
    }

    async capture(reason = 'manual') {
        if (!this.context.has?.()) return null;
        const views = this.reader.readViews();
        const snapshot = {
            botId: this.botId,
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
        this.latestSnapshot = snapshot;
        await this.store.write(snapshot);
        this.eventBus?.emit('inventory:observed', {
            botId: this.botId,
            capturedAt: snapshot.capturedAt,
            sources: snapshot.views.map(view => view.source),
            reason
        });
        return snapshot;
    }

    latest({ maxAgeMs = Infinity } = {}) {
        if (!this.latestSnapshot) return null;
        if (Date.now() - Number(this.latestSnapshot.capturedAt || 0) > maxAgeMs) return null;
        return this.latestSnapshot;
    }

    eventsSince(timestamp = 0) {
        const since = Number(timestamp) || 0;
        return this.recentEvents.filter(event => Number(event.at || 0) >= since).map(event => ({ ...event }));
    }

    clearEventsBefore(timestamp = Date.now()) {
        const cutoff = Number(timestamp) || 0;
        this.recentEvents = this.recentEvents.filter(event => Number(event.at || 0) >= cutoff);
    }

    #recordDelta({ source, windowId = null, slot, oldItem, newItem }) {
        const event = {
            at: Date.now(),
            source,
            windowId,
            slot: Number.isInteger(slot) ? slot : null,
            oldItem: stableItem(this.normalizer, oldItem, slot),
            newItem: stableItem(this.normalizer, newItem, slot)
        };
        this.recentEvents.push(event);
        if (this.recentEvents.length > this.historyLimit) {
            this.recentEvents.splice(0, this.recentEvents.length - this.historyLimit);
        }
        this.eventBus?.emit('inventory:delta', { botId: this.botId, ...event });
        return event;
    }

    #enrichDeltaIdentity(event, candidateItem) {
        if (!event || !candidateItem || !event.newItem) return;
        const candidate = stableItem(this.normalizer, candidateItem, event.slot);
        if (!candidate) return;
        mergeIdentityMetadata(event.newItem, candidate);
    }

    #bindInventory(bot) {
        this.inventoryCleanup?.();
        const inventory = bot?.inventory;
        if (!inventory?.on) {
            this.inventoryCleanup = null;
            return;
        }
        const onUpdateSlot = (slot, oldItem, newItem) => {
            const event = this.#recordDelta({ source: 'bot-inventory', slot, oldItem, newItem });
            // Treat updateSlot as the change signal only. For custom server items
            // the callback payload can omit component/custom-data fields even
            // though the authoritative inventory slot already has them. Enrich
            // identity from the real slot without replacing the callback count.
            this.#enrichDeltaIdentity(event, inventory.slots?.[slot]);
            queueMicrotask(() => this.#enrichDeltaIdentity(event, inventory.slots?.[slot]));
            this.schedule('bot-inventory-update');
        };
        inventory.on('updateSlot', onUpdateSlot);
        this.inventoryCleanup = () => inventory.off?.('updateSlot', onUpdateSlot);
    }

    #bindWindow(window) {
        this.windowCleanup?.();
        this.windowCleanup = null;
        if (!window?.on) return;
        const onUpdateSlot = (slot, oldItem, newItem) => {
            const start = Number(window.inventoryStart);
            const end = Number.isInteger(Number(window.inventoryEnd)) ? Number(window.inventoryEnd) : window.slots?.length;
            if (!Number.isInteger(start) || slot < start || (Number.isInteger(end) && slot >= end)) return;
            const event = this.#recordDelta({
                source: 'current-window',
                windowId: window.id ?? null,
                slot,
                oldItem,
                newItem
            });
            this.#enrichDeltaIdentity(event, window.slots?.[slot]);
            queueMicrotask(() => this.#enrichDeltaIdentity(event, window.slots?.[slot]));
            this.schedule('current-window-inventory-update');
        };
        window.on('updateSlot', onUpdateSlot);
        this.windowCleanup = () => window.off?.('updateSlot', onUpdateSlot);
    }

    async stop() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.inventoryCleanup?.();
        this.inventoryCleanup = null;
        this.windowCleanup?.();
        this.windowCleanup = null;
        for (const off of this.cleanup.splice(0)) off();
    }

    async destroy() { await this.stop(); }
}

module.exports = InventoryObservationService;
