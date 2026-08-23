'use strict';

const BotContext = require('../bot/BotContext');
const CommandGuard = require('../commands/CommandGuard');
const CommandExecutor = require('../commands/CommandExecutor');
const ClickExecutor = require('../gui/click/ClickExecutor');
const ModeCoordinator = require('../modes/ModeCoordinator');
const CancellationSource = require('../shared/cancellation/CancellationSource');
const { immutableClone } = require('../shared/utils/object');

class SimulationClient {
    constructor({ id, record }) {
        this.id = id;
        this.currentWindow = null;
        this.record = record;
    }

    chat(command) {
        this.record({ type: 'chat', clientId: this.id, command: String(command) });
    }

    async clickWindow(slot, button, mode) {
        this.record({ type: 'click', clientId: this.id, slot, button, mode, windowId: this.currentWindow?.id || null });
    }

    end(reason) {
        this.record({ type: 'end', clientId: this.id, reason: String(reason || '') });
    }
}

class SafetyReplayRuntime {
    constructor({ botId = 'replay-bot', clock, minimumCommandIntervalMs = 50 } = {}) {
        if (!clock || typeof clock.now !== 'function' || typeof clock.delay !== 'function') throw new TypeError('virtual clock is required');
        this.botId = botId;
        this.clock = clock;
        this.context = new BotContext(botId);
        this.clients = new Map();
        this.captures = new Map();
        this.leaseCaptures = new Map();
        this.cancellations = new Map();
        this.sideEffects = [];
        this.sideEffectSequence = 0;
        this.leaseSequence = 0;
        this.commandGuard = new CommandGuard({
            context: this.context,
            minimumIntervalMs: minimumCommandIntervalMs,
            now: () => this.clock.now()
        });
        this.commandExecutor = new CommandExecutor({
            context: this.context,
            guard: this.commandGuard,
            delay: (milliseconds, options) => this.clock.delay(milliseconds, options),
            now: () => this.clock.now()
        });
        this.clickExecutor = new ClickExecutor({ context: this.context });
        this.modeCoordinator = new ModeCoordinator({
            botId,
            clock: () => this.clock.now(),
            idFactory: () => `replay-lease-${++this.leaseSequence}`
        });
    }

    install(harness) {
        const actions = {
            'connection.attach': payload => this.#attach(payload),
            'connection.detach': () => this.#detach(),
            'gui.open': payload => this.#openWindow(payload),
            'ownership.capture': payload => this.#capture(payload),
            'cancellation.create': payload => this.#createCancellation(payload),
            'cancellation.cancel': payload => this.#cancel(payload),
            'command.send': payload => this.#sendCommand(payload),
            'gui.click': payload => this.#click(payload),
            'mode.acquire': payload => this.#acquireMode(payload),
            'mode.pause': payload => this.#transitionMode('pause', payload),
            'mode.resume': payload => this.#transitionMode('resume', payload),
            'mode.release': payload => this.#transitionMode('release', payload),
            'clock.delay': payload => this.clock.delay(Number(payload.delayMs || 0), { label: payload.label || 'replay-action-delay' }),
            'state.snapshot': () => this.snapshot()
        };
        for (const [name, handler] of Object.entries(actions)) harness.registerAction(name, handler);
        harness.addCleanup(() => this.dispose());
        return this;
    }

    snapshot() {
        return immutableClone({
            botId: this.botId,
            connected: this.context.has(),
            connectionGeneration: this.context.getGeneration(),
            clientId: this.context.get()?.id || null,
            windowId: this.context.get()?.currentWindow?.id || null,
            sideEffects: this.sideEffects,
            modeCoordinator: this.modeCoordinator.snapshot(),
            captures: [...this.captures.entries()].map(([id, capture]) => ({
                id,
                clientId: capture.client.id,
                windowId: capture.window?.id || null,
                connectionGeneration: capture.generation
            })).sort((left, right) => left.id.localeCompare(right.id)),
            leaseCaptures: [...this.leaseCaptures.entries()].map(([id, lease]) => ({
                id,
                leaseId: lease.leaseId,
                modeId: lease.modeId
            })).sort((left, right) => left.id.localeCompare(right.id)),
            cancellations: [...this.cancellations.entries()].map(([id, source]) => ({
                id,
                cancelled: source.token.isCancelled,
                reason: source.token.reason || null
            })).sort((left, right) => left.id.localeCompare(right.id))
        });
    }

    async dispose() {
        for (const source of this.cancellations.values()) source.dispose();
        this.cancellations.clear();
        this.captures.clear();
        this.leaseCaptures.clear();
        const client = this.context.get();
        if (client) this.context.detach(client);
        await this.modeCoordinator.destroy();
    }

    #attach(payload) {
        const id = String(payload.clientId || '').trim();
        if (!id) throw new TypeError('connection.attach requires clientId');
        const previous = this.context.get();
        if (previous) this.context.detach(previous);
        let client = this.clients.get(id);
        if (!client) {
            client = new SimulationClient({ id, record: effect => this.#recordSideEffect(effect) });
            this.clients.set(id, client);
        }
        client.currentWindow = null;
        const connectionGeneration = this.context.attach(client);
        return { clientId: id, connectionGeneration };
    }

    #detach() {
        const client = this.context.get();
        return {
            detached: client ? this.context.detach(client) : false,
            connectionGeneration: this.context.getGeneration()
        };
    }

    #openWindow(payload) {
        const client = this.context.require();
        const id = String(payload.windowId || '').trim();
        const slotCount = Number(payload.slotCount ?? 54);
        if (!id || !Number.isInteger(slotCount) || slotCount < 1) throw new TypeError('gui.open requires windowId and positive slotCount');
        client.currentWindow = { id, slots: Array.from({ length: slotCount }, () => null) };
        return { clientId: client.id, windowId: id, slotCount, connectionGeneration: this.context.getGeneration() };
    }

    #capture(payload) {
        const id = String(payload.captureId || '').trim();
        if (!id) throw new TypeError('ownership.capture requires captureId');
        if (this.captures.has(id)) throw new Error(`Replay ownership capture already exists: ${id}`);
        const client = this.context.require();
        this.captures.set(id, {
            client,
            window: client.currentWindow,
            generation: this.context.getGeneration()
        });
        return { captureId: id, clientId: client.id, windowId: client.currentWindow?.id || null, connectionGeneration: this.context.getGeneration() };
    }

    #createCancellation(payload) {
        const id = String(payload.cancellationId || '').trim();
        if (!id) throw new TypeError('cancellation.create requires cancellationId');
        if (this.cancellations.has(id)) throw new Error(`Replay cancellation already exists: ${id}`);
        this.cancellations.set(id, new CancellationSource());
        return { cancellationId: id, created: true };
    }

    #cancel(payload) {
        const id = String(payload.cancellationId || '').trim();
        const source = this.cancellations.get(id);
        if (!source) throw new Error(`Replay cancellation not found: ${id}`);
        return { cancellationId: id, cancelled: source.cancel(payload.reason || 'Replay cancellation') };
    }

    #sendCommand(payload) {
        const command = String(payload.command || '');
        const capture = this.#optionalCapture(payload.captureId);
        const cancellation = this.#optionalCancellation(payload.cancellationId);
        return this.commandExecutor.execute(command, {
            sensitive: Boolean(payload.sensitive),
            expectedGeneration: payload.expectedGeneration ?? capture?.generation ?? this.context.getGeneration(),
            cancellationToken: cancellation?.token || null
        });
    }

    #click(payload) {
        const capture = this.#optionalCapture(payload.captureId) || {
            client: this.context.require(),
            window: this.context.require().currentWindow,
            generation: this.context.getGeneration()
        };
        const cancellation = this.#optionalCancellation(payload.cancellationId);
        return this.clickExecutor.click({
            slot: Number(payload.slot),
            button: Number(payload.button || 0),
            mode: Number(payload.mode || 0),
            expectedGeneration: payload.expectedGeneration ?? capture.generation,
            capturedClient: capture.client,
            capturedWindow: capture.window,
            cancellationToken: cancellation?.token || null
        });
    }

    #acquireMode(payload) {
        const result = this.modeCoordinator.acquire(payload.modeId, {
            requestedResources: payload.requestedResources,
            reason: payload.reason,
            metadata: payload.metadata
        });
        if (result.success && payload.captureLeaseAs) {
            this.leaseCaptures.set(String(payload.captureLeaseAs), result.data);
        }
        return result;
    }

    #transitionMode(action, payload) {
        const lease = payload.leaseId || this.leaseCaptures.get(String(payload.leaseCaptureId || ''));
        return this.modeCoordinator[action](payload.modeId, lease);
    }

    #optionalCapture(id) {
        if (id === undefined || id === null) return null;
        const capture = this.captures.get(String(id));
        if (!capture || !capture.client) throw new Error(`Replay ownership capture not found: ${id}`);
        return capture;
    }

    #optionalCancellation(id) {
        if (id === undefined || id === null) return null;
        const source = this.cancellations.get(String(id));
        if (!source) throw new Error(`Replay cancellation not found: ${id}`);
        return source;
    }

    #recordSideEffect(effect) {
        this.sideEffects.push(immutableClone({
            sequence: ++this.sideEffectSequence,
            atMs: this.clock.now(),
            connectionGeneration: this.context.getGeneration(),
            ...effect
        }));
    }
}

module.exports = SafetyReplayRuntime;
