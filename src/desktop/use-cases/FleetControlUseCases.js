'use strict';

const { randomUUID } = require('node:crypto');
const Redactor = require('../../shared/security/Redactor');
const { plainError, resultPayload } = require('../contracts/DesktopResult');

class FleetControlUseCases {
    constructor({ bundleProvider, requireRunning, uuid = randomUUID } = {}) {
        if (typeof bundleProvider !== 'function' || typeof requireRunning !== 'function') {
            throw new TypeError('FleetControlUseCases requires bundleProvider and requireRunning.');
        }
        Object.assign(this, { bundleProvider, requireRunning, uuid });
    }

    async connect(botId) {
        this.requireRunning();
        return resultPayload(await this.#fleet().requestConnection(botId, 'CONNECTED', { source: 'desktop-bot-card' }));
    }

    async disconnect(botId) {
        this.requireRunning();
        return resultPayload(await this.#fleet().requestConnection(botId, 'DISCONNECTED', { source: 'desktop-bot-card' }));
    }

    async startMode(botId, mode) {
        this.requireRunning();
        return resultPayload(await this.#fleet().requestMode(botId, mode, { state: 'ACTIVE', source: 'desktop' }));
    }

    async pauseMode(botId) {
        this.requireRunning();
        return resultPayload(await this.#fleet().requestModeState(botId, 'PAUSED', { source: 'desktop' }));
    }

    async resumeMode(botId) {
        this.requireRunning();
        return resultPayload(await this.#fleet().requestModeState(botId, 'ACTIVE', { source: 'desktop' }));
    }

    async stopMode(botId) {
        this.requireRunning();
        return resultPayload(await this.#fleet().requestMode(botId, null, { source: 'desktop' }));
    }

    async restartMode(botId) {
        this.requireRunning();
        const intent = this.#fleet().intent(botId);
        if (!intent?.desiredMode) throw new Error(`No durable mode intent exists for ${botId}.`);
        return resultPayload(await this.#fleet().restartMode(botId, intent.desiredMode, { source: 'desktop' }));
    }

    async reconcile(reason = 'desktop-reconcile') {
        this.requireRunning();
        return Redactor.sanitize(await this.#fleet().reconcileAll({ reason, priority: 'high' }));
    }

    async home(botId) {
        const runtime = this.#runtime(botId);
        return resultPayload(await runtime.requireService('serverFeatureFacade').island().goHome());
    }

    async fleetAction(action) {
        this.requireRunning();
        const fleet = this.#fleet();
        const profiles = fleet.profileSnapshot();
        const enabledBotIds = Object.keys(profiles).filter(botId => profiles[botId]?.enabled !== false);
        const botIds = ['pause-all', 'resume-all'].includes(action)
            ? enabledBotIds.filter(botId => Boolean(fleet.intent?.(botId)?.desiredMode))
            : enabledBotIds;
        if (action === 'emergency-stop') {
            const transaction = await fleet.emergencyStop(botIds, {
                source: 'desktop-emergency',
                idempotencyKey: `desktop:${this.uuid()}`,
                timeoutMs: 15000
            });
            return { action, success: transaction.outcome === 'SUCCESS', ...transaction };
        }
        const runners = {
            'connect-all': botId => fleet.requestConnection(botId, 'CONNECTED', { source: 'desktop-fleet' }),
            'pause-all': botId => fleet.requestModeState(botId, 'PAUSED', { source: 'desktop-fleet' }),
            'resume-all': botId => fleet.requestModeState(botId, 'ACTIVE', { source: 'desktop-fleet' }),
            'stop-modes-all': botId => fleet.requestMode(botId, null, { source: 'desktop-fleet' }),
            'disconnect-all': botId => fleet.requestConnection(botId, 'DISCONNECTED', { source: 'desktop-fleet' }),
            'home-all': async botId => {
                const runtime = this.#runtime(botId);
                if (!runtime.context.has()) return { success: true, status: 'SKIPPED_DISCONNECTED', data: { botId } };
                return runtime.requireService('serverFeatureFacade').island().goHome();
            }
        };
        const run = runners[action];
        if (!run) throw new Error(`Unknown fleet action: ${action}`);
        const settled = await Promise.allSettled(botIds.map(async botId => ({ botId, result: resultPayload(await run(botId)) })));
        const results = settled.map((entry, index) => entry.status === 'fulfilled'
            ? entry.value
            : { botId: botIds[index], result: { success: false, error: plainError(entry.reason) } });
        return { action, success: results.every(entry => entry.result?.success !== false), results };
    }

    #fleet() {
        return this.bundleProvider().fleetControl;
    }

    #runtime(botId) {
        this.requireRunning();
        return this.bundleProvider().application.getRuntime(botId);
    }
}

module.exports = FleetControlUseCases;

