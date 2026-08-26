'use strict';

const { normalizeConnectionGeneration } = require('../core/events/EventEnvelope');

class GuiWindowSessionBinding {
    constructor({ botId, context, eventBus = null, currentSession, onOpen, onClose, onUpdate }) {
        if (!botId || !context || typeof currentSession !== 'function') throw new TypeError('GuiWindowSessionBinding identity, context and currentSession are required.');
        if (typeof onOpen !== 'function' || typeof onClose !== 'function' || typeof onUpdate !== 'function') {
            throw new TypeError('GuiWindowSessionBinding callbacks are required.');
        }
        Object.assign(this, { botId, context, eventBus, currentSession, onOpen, onClose, onUpdate });
        this.cleanup = [];
        this.windowCleanup = null;
        this.boundClient = null;
        this.boundGeneration = null;
        this.boundCleanup = null;
    }

    initialize() {
        const bot = this.context.get();
        if (bot) this.bind(bot, this.context.getGeneration());
        if (!this.eventBus) return;
        this.cleanup.push(
            this.eventBus.on('connection:spawned', event => {
                if (event.botId !== this.botId) return;
                const generation = normalizeConnectionGeneration(event);
                const current = this.context.get();
                if (!current || generation === null || generation !== Number(this.context.getGeneration())) return;
                this.bind(current, generation);
            }),
            this.eventBus.on('connection:ended', event => {
                if (event.botId !== this.botId) return;
                const generation = normalizeConnectionGeneration(event);
                if (generation === null || generation !== Number(this.boundGeneration)) return;
                this.unbindClient();
                if (Number(this.currentSession()?.connectionGeneration) === generation) this.onClose();
            })
        );
    }

    bind(bot, generation = this.context.getGeneration()) {
        const canonicalGeneration = Number(generation);
        if (!bot || !Number.isInteger(canonicalGeneration) || canonicalGeneration <= 0) return;
        if (this.boundClient === bot && Number(this.boundGeneration) === canonicalGeneration) return;
        this.unbindClient();
        let cleaned = false;
        const isCurrent = () => this.context.get?.() === bot && Number(this.context.getGeneration?.()) === canonicalGeneration;
        const open = window => { if (isCurrent()) this.onOpen(window, { client: bot, connectionGeneration: canonicalGeneration }); };
        const close = () => {
            if (isCurrent() && Number(this.currentSession()?.connectionGeneration) === canonicalGeneration) this.onClose();
        };
        const onEnd = () => {
            if (this.boundClient !== bot || Number(this.boundGeneration) !== canonicalGeneration) return;
            cleanup();
            if (Number(this.currentSession()?.connectionGeneration) === canonicalGeneration) this.onClose();
        };
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            bot.off?.('windowOpen', open);
            bot.off?.('windowClose', close);
            bot.off?.('end', onEnd);
        };
        bot.on?.('windowOpen', open);
        bot.on?.('windowClose', close);
        bot.on?.('end', onEnd);
        this.boundClient = bot;
        this.boundGeneration = canonicalGeneration;
        this.boundCleanup = cleanup;
    }

    bindWindow(window, sessionId) {
        this.unbindWindow();
        if (!window?.on) return;
        const onUpdateSlot = () => this.onUpdate(sessionId);
        window.on('updateSlot', onUpdateSlot);
        this.windowCleanup = () => window.off?.('updateSlot', onUpdateSlot);
    }

    unbindWindow() {
        this.windowCleanup?.();
        this.windowCleanup = null;
    }

    unbindClient() {
        this.boundCleanup?.();
        this.boundCleanup = null;
        this.boundClient = null;
        this.boundGeneration = null;
    }

    stop() {
        this.unbindWindow();
        this.unbindClient();
        for (const dispose of this.cleanup.splice(0)) dispose?.();
    }
}

module.exports = GuiWindowSessionBinding;
