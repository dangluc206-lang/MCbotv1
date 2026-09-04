'use strict';

const WorkflowDefinitionValidator = require('./WorkflowDefinitionValidator');
const WorkflowResourceBudget = require('./WorkflowResourceBudget');

class WorkflowDryRunService {
    constructor({ validator = new WorkflowDefinitionValidator(), maxExpandedSteps = 5000 } = {}) {
        this.validator = validator;
        this.maxExpandedSteps = Math.max(1, Math.min(50000, Number(maxExpandedSteps) || 5000));
    }

    simulate(definition, { connected = true, guiId = null } = {}) {
        const normalized = this.validator.normalize(definition);
        const plan = [];
        const unreachedPaths = [];
        const state = { connected:connected === true, guiId:guiId || null };
        const budget = new WorkflowResourceBudget(normalized.resourceBudget);
        const visit = (steps, path) => {
            for (let index = 0; index < steps.length; index += 1) {
                const step = steps[index];
                if (plan.length >= this.maxExpandedSteps) {
                    const error = new Error(`Dry-run vượt trần ${this.maxExpandedSteps} bước mở rộng.`);
                    error.code = 'WORKFLOW_DRY_RUN_LIMIT'; throw error;
                }
                const descriptor = this.validator.modules.require(step.type);
                budget.step();
                if (step.type === 'wait') budget.wait(step.ms);
                if (step.type === 'repeat') budget.repeat(step.count);
                if (descriptor.capability) budget.operation();
                plan.push(Object.freeze({ index:plan.length, path:`${path}[${index}]`, type:step.type, capability:descriptor.capability, risk:descriptor.presentation.risk, sideEffect:descriptor.transientResources.length > 0 || Boolean(descriptor.capability) }));
                if (step.type === 'if') {
                    const matched = step.condition.type === 'connected' ? state.connected
                        : step.condition.type === 'gui-open' ? Boolean(state.guiId && (!step.condition.guiId || state.guiId === step.condition.guiId))
                            : !Boolean(state.guiId && (!step.condition.guiId || state.guiId === step.condition.guiId));
                    const selected = matched ? 'then' : 'else';
                    const notSelected = matched ? 'else' : 'then';
                    unreachedPaths.push(`${path}[${index}].${notSelected}`);
                    visit(step[selected], `${path}[${index}].${selected}`);
                }
                if (step.type === 'repeat') for (let repeat = 0; repeat < step.count; repeat += 1) visit(step.steps, `${path}[${index}].steps#${repeat}`);
                if (step.type === 'close-gui') state.guiId = null;
            }
        };
        visit(normalized.workflow.start, 'workflow.start');
        visit(normalized.workflow.loop.steps, 'workflow.loop.steps');
        visit(normalized.workflow.stop, 'workflow.stop');
        return Object.freeze({
            contract:'workflow-dry-run-v1', modeId:normalized.id, valid:true,
            simulatedOnly:true, capabilityCalls:0, expandedSteps:plan.length,
            estimatedSideEffects:plan.filter(step => step.sideEffect).length,
            requiredCapabilities:[...normalized.requiredCapabilities],
            requestedResources:[...normalized.requestedResources],
            checks:Object.freeze({ schema:'PASS', forbiddenActions:'PASS', loopBounds:'PASS', capabilityDependencies:'DECLARED', resourceClaims:'DECLARED', resourceBudget:'PASS' }),
            inputState:Object.freeze({ connected:state.connected, guiId:guiId || null }),
            unreachedPaths:Object.freeze(unreachedPaths),
            resourceBudget:budget.snapshot(),
            plan:Object.freeze(plan)
        });
    }
}

module.exports = WorkflowDryRunService;
