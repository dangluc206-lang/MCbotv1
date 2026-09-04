'use strict';

const FlowError = require('../../shared/errors/FlowError');
const WorkflowModuleCatalog = require('./WorkflowModuleCatalog');
const WorkflowResourceBudget = require('./WorkflowResourceBudget');

class WorkflowStepExecutor {
    constructor({ botId, modeId, modeContext, logger = null, onPhase = null, moduleCatalog = new WorkflowModuleCatalog() } = {}) {
        Object.assign(this, { botId, modeId, modeContext, logger, onPhase, moduleCatalog });
    }

    async executeSteps(steps, { cancellationToken, variables = {}, depth = 0, budget = null } = {}) {
        const activeBudget = budget || new WorkflowResourceBudget();
        const results = [];
        for (let index = 0; index < (steps || []).length; index += 1) {
            cancellationToken?.throwIfCancelled?.();
            const step = steps[index];
            this.onPhase?.(`MODULE_${String(step.type).toUpperCase().replaceAll('-', '_')}`);
            try {
                const descriptor = this.moduleCatalog.require(step.type);
                activeBudget.step();
                const data = await this.execute(step, { cancellationToken, variables, depth, budget: activeBudget });
                results.push(Object.freeze({ contractVersion: 1, moduleType: descriptor.type, outputType: descriptor.outputType, outcome: 'SUCCESS', data: data === undefined ? null : data }));
            } catch (error) {
                throw FlowError.wrap(error, {
                    code: error?.code || 'COMPOSABLE_MODE_STEP_FAILED', subsystem: 'composable-mode', operation: this.modeId,
                    step: `${step.type}:${index}`, action: step.type, resource: this.modeId,
                    details: { stepIndex: index, type: step.type, i18nKey: this.moduleCatalog.require(step.type).i18nKey, budget: activeBudget.snapshot() }
                });
            }
        }
        return results;
    }

    async execute(step, { cancellationToken, variables = {}, depth = 0, budget } = {}) {
        const descriptor = this.moduleCatalog.require(step.type);
        if (!descriptor.executor) {
            const error = new Error(`Module executor is not registered: ${step.type}`);
            error.code = 'WORKFLOW_MODULE_EXECUTOR_MISSING';
            throw error;
        }
        return descriptor.executor.execute(step, {
            botId: this.botId, modeId: this.modeId, modeContext: this.modeContext, logger: this.logger,
            cancellationToken, variables, depth, budget,
            condition: condition => this.#condition(condition),
            executeSteps: (nestedSteps, options = {}) => this.executeSteps(nestedSteps, {
                cancellationToken, variables, depth: depth + 1, budget, ...options
            })
        });
    }

    #condition(condition = {}) {
        if (condition.type === 'connected') return this.modeContext.connected();
        if (condition.type === 'gui-open' || condition.type === 'not-gui-open') {
            const current = this.modeContext.capability('gui').current?.() || null;
            const match = Boolean(current?.active && (!condition.guiId || current.definitionId === condition.guiId));
            return condition.type === 'gui-open' ? match : !match;
        }
        return false;
    }

}

module.exports = WorkflowStepExecutor;
