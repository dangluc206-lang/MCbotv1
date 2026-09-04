'use strict';

class WorkflowResourceBudget {
    constructor(limits = {}) {
        this.limits = Object.freeze({
            maxSteps: Number.isInteger(limits.maxSteps) ? limits.maxSteps : 2000,
            maxRepeats: Number.isInteger(limits.maxRepeats) ? limits.maxRepeats : 1000,
            maxWaitMs: Number.isFinite(limits.maxWaitMs) ? limits.maxWaitMs : 3600000,
            maxOperations: Number.isInteger(limits.maxOperations) ? limits.maxOperations : 1000
        });
        this.usage = { steps: 0, repeats: 0, waitMs: 0, operations: 0 };
    }

    step() { this.#consume('steps', this.limits.maxSteps, 1, 'WORKFLOW_RESOURCE_BUDGET_STEPS'); }
    repeat(count = 1) { this.#consume('repeats', this.limits.maxRepeats, count, 'WORKFLOW_RESOURCE_BUDGET_REPEATS'); }
    wait(ms = 0) { this.#consume('waitMs', this.limits.maxWaitMs, Number(ms) || 0, 'WORKFLOW_RESOURCE_BUDGET_WAIT'); }
    operation() { this.#consume('operations', this.limits.maxOperations, 1, 'WORKFLOW_RESOURCE_BUDGET_OPERATIONS'); }
    snapshot() { return Object.freeze({ limits: { ...this.limits }, usage: { ...this.usage } }); }

    #consume(key, limit, amount, code) {
        if (amount < 0 || this.usage[key] + amount > limit) {
            const error = new Error(`Workflow resource budget exceeded: ${key}`);
            error.code = code;
            error.details = { resource: key, limit, used: this.usage[key], requested: amount };
            throw error;
        }
        this.usage[key] += amount;
    }
}

module.exports = WorkflowResourceBudget;
