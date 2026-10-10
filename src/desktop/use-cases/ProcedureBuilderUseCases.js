'use strict';

const ProcedureRegistry = require('../../server-features/crafting/procedure/ProcedureRegistry');
const ProcedureStepCatalog = require('../../server-features/crafting/procedure/ProcedureStepCatalog');
const QuantityStrategy = require('../../server-features/crafting/quantity/QuantityStrategy');

function valueAtPath(object, dottedKey) {
    return dottedKey.split('.').reduce((value, key) => (value == null ? value : value[key]), object);
}

function missingRequired(step) {
    const errors = [];
    const { fields } = ProcedureStepCatalog.require(step.type);
    for (const field of fields) {
        if (!field.required) continue;
        const value = valueAtPath(step, field.key);
        const empty = value == null
            || (typeof value === 'string' && !value.trim())
            || (field.type === 'integer' && !Number.isInteger(Number(value)));
        if (empty) errors.push(`step '${step.type}' thiếu tham số bắt buộc: ${field.key}`);
        else if (field.pattern && !new RegExp(field.pattern).test(String(value))) {
            errors.push(`step '${step.type}' tham số ${field.key} không khớp pattern ${field.pattern}`);
        }
    }
    return errors;
}

/**
 * Procedure Builder use-case (G20).
 * Operator-facing entry point over the domain ProcedureBuilder inputs:
 * catalog / validate / dry-run. Dry-run is pure: registry normalization plus
 * the existing QuantityStrategy batch plan, zero capability calls.
 */
class ProcedureBuilderUseCases {
    constructor({ quantityStrategy = null } = {}) {
        this.quantity = quantityStrategy || new QuantityStrategy();
    }

    catalog() {
        return ProcedureStepCatalog.list();
    }

    validate(draft) {
        const errors = [];
        if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
            return { valid: false, errors: ['procedure draft phải là object.'] };
        }
        const id = String(draft.id || '').trim();
        if (!id) errors.push('procedure id là bắt buộc.');
        const steps = Array.isArray(draft.steps) ? draft.steps : [];
        if (!steps.length) errors.push('procedure phải có ít nhất một step.');
        steps.forEach((step, index) => {
            if (!step || typeof step !== 'object') { errors.push(`step ${index} phải là object.`); return; }
            try { ProcedureStepCatalog.require(step.type); }
            catch (error) { errors.push(`step ${index}: ${error.message}`); return; }
            errors.push(...missingRequired(step).map(message => `step ${index}: ${message}`));
        });
        if (errors.length) return { valid: false, errors };
        try {
            const normalized = new ProcedureRegistry({ [id]: {
                label: draft.label || id,
                description: draft.description || '',
                quantityStrategy: draft.quantityStrategy || 'button-batch',
                maxBatch: draft.maxBatch,
                steps
            } }).require(id);
            return { valid: true, errors: [], normalized };
        } catch (error) {
            return { valid: false, errors: [error.message] };
        }
    }

    dryRun(draft, { requested = 100, outputAmount = 1 } = {}) {
        const validation = this.validate(draft);
        if (!validation.valid) {
            const error = new Error(validation.errors.join(' · '));
            error.code = 'PROCEDURE_INVALID';
            throw error;
        }
        const normalized = validation.normalized;
        const amount = Number(requested);
        if (!Number.isSafeInteger(amount) || amount <= 0) {
            const error = new Error('dry-run requested phải là số nguyên dương.');
            error.code = 'PROCEDURE_INVALID';
            throw error;
        }
        const batches = this.quantity.plan({
            requested: amount,
            remaining: amount,
            outputAmount: Math.max(1, Number(outputAmount) || 1),
            capabilities: { strategy: normalized.quantityStrategy, maxBatch: normalized.maxBatch }
        });
        const steps = normalized.steps.map((step, index) => ({
            index, type: step.type, owner: ProcedureStepCatalog.require(step.type).owner
        }));
        return Object.freeze({
            contract: 'procedure-dry-run-v1',
            valid: true,
            simulatedOnly: true,
            capabilityCalls: 0,
            id: normalized.id,
            label: normalized.label,
            quantityStrategy: normalized.quantityStrategy,
            maxBatch: normalized.maxBatch,
            requested: amount,
            batches: Object.freeze(batches),
            steps: Object.freeze(steps),
            ownerCounts: Object.freeze({
                runtime: steps.filter(step => step.owner === 'runtime').length,
                operation: steps.filter(step => step.owner === 'operation').length
            }),
            checks: Object.freeze({ stepCatalog: 'PASS', requiredParams: 'PASS', registryNormalize: 'PASS', quantityPlan: 'PASS' })
        });
    }
}

module.exports = ProcedureBuilderUseCases;