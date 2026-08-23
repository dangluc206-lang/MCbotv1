'use strict';

const ManagedMode = require('../ManagedMode');
const Timeout = require('../../shared/time/Timeout');
const WorkflowStepExecutor = require('./WorkflowStepExecutor');

class ComposableModeService extends ManagedMode {
    constructor({ botId, modeId, definition, modeContext, modeCoordinator, catalog, logger = null } = {}) {
        super({ modeId, botId, modeContext, modeCoordinator, catalog, logger });
        this.workflow = definition.workflow;
        this.executor = new WorkflowStepExecutor({ botId, modeId, modeContext, logger, onPhase: phase => this.setPhase(phase) });
        this.supervisor = null;
        this.cycles = 0;
        this.lastCycleAt = null;
        this.lastErrorMessage = null;
    }

    async onEnable() {
        this.supervisor = this.createTaskSupervisor('workflow', { historyLimit: 8 });
        if (this.workflow.start.length) {
            this.setPhase('START_STEPS');
            await this.executor.executeSteps(this.workflow.start, { cancellationToken: null });
        }
        this.#startLoop();
    }

    async onPause(reason) { await this.supervisor?.stop('loop', reason || 'Workflow paused.'); }
    async onResume() { this.#startLoop(); }
    async onDisable(reason) {
        await this.supervisor?.stopAll(reason || 'Workflow stopped.');
        if (this.workflow.stop.length) {
            this.setPhase('STOP_STEPS');
            await this.executor.executeSteps(this.workflow.stop, {});
        }
        this.supervisor = null;
    }

    statusDetails() {
        return { cycles: this.cycles, lastCycleAt: this.lastCycleAt, lastErrorMessage: this.lastErrorMessage, workflow: { loopEnabled: this.workflow.loop.enabled, intervalMs: this.workflow.loop.intervalMs }, tasks: this.supervisor?.snapshot?.() || null };
    }

    #startLoop() {
        if (!this.workflow.loop.enabled || !this.supervisor || this.supervisor.get('loop')) return;
        const handle = this.supervisor.start('loop', async task => {
            while (!task.cancellationToken.isCancelled && this.enabled && !this.paused) {
                try {
                    await this.executor.executeSteps(this.workflow.loop.steps, { cancellationToken: task.cancellationToken });
                    this.cycles += 1;
                    this.lastCycleAt = new Date().toISOString();
                    this.lastErrorMessage = null;
                } catch (error) {
                    this.lastErrorMessage = error.message;
                    if (!this.workflow.loop.continueOnError) throw error;
                    this.logger?.warn?.('Composable mode cycle failed but continueOnError is enabled.', { botId: this.botId, modeId: this.modeId, error });
                }
                this.setPhase('WAITING_NEXT_CYCLE');
                await Timeout.delay(this.workflow.loop.intervalMs, { cancellationToken: task.cancellationToken });
            }
        }, { restart: 'on-failure', maxRestarts: 50, baseDelayMs: 1000, maxDelayMs: 30000 });
        handle.promise.catch(error => {
            if (error?.code === 'CANCELLED') return;
            this.lastErrorMessage = error.message;
            this.setPhase('ERROR');
        });
    }
}

module.exports = ComposableModeService;
