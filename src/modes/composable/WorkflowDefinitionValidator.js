'use strict';

const WorkflowModuleCatalog = require('./WorkflowModuleCatalog');
const WorkflowSchemaMigrator = require('./WorkflowSchemaMigrator');
const normalizeStepFields = require('./WorkflowStepNormalizer');
const MODE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const CONTRACT_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const RESOURCE_ID = /^[a-z][a-z0-9]*(?:[-.:][a-z0-9]+)*$/;

class WorkflowDefinitionValidator {
    constructor({ maxSteps = 200, maxDepth = 6, maxRepeat = 1000, maxWaitMs = 3600000, moduleCatalog = new WorkflowModuleCatalog(), schemaMigrator = new WorkflowSchemaMigrator(), serverProfile = 'minerua', capabilityRegistry = null } = {}) {
        Object.assign(this, { maxSteps, maxDepth, maxRepeat, maxWaitMs, schemaMigrator, serverProfile, capabilityRegistry });
        this.modules = moduleCatalog;
    }

    normalize(value) {
        value = this.schemaMigrator.migrate(value);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Định nghĩa mode phải là object.');
        const id = String(value.id || '').trim();
        if (!MODE_ID.test(id)) throw new TypeError('Mode ID chỉ dùng chữ thường, số và dấu gạch ngang.');
        const label = String(value.label || id).trim();
        if (!label) throw new TypeError('Tên hiển thị mode không được trống.');
        const workflow = value.workflow || {};
        const start = this.#steps(workflow.start || [], 'workflow.start', 0);
        const loopSteps = this.#steps(workflow.loop?.steps || [], 'workflow.loop.steps', 0);
        const stop = this.#steps(workflow.stop || [], 'workflow.stop', 0);
        const intervalMs = Number(workflow.loop?.intervalMs ?? 1000);
        if (!Number.isFinite(intervalMs) || intervalMs < 50 || intervalMs > this.maxWaitMs) {
            throw new TypeError(`workflow.loop.intervalMs phải trong khoảng 50..${this.maxWaitMs}.`);
        }
        const required = new Set(Array.isArray(value.requiredCapabilities) ? value.requiredCapabilities.map(String).map(item => item.trim()).filter(Boolean) : []);
        for (const capability of required) if (!CONTRACT_ID.test(capability)) throw new TypeError(`Capability ID không hợp lệ: ${capability}.`);
        this.#collectCapabilities([...start, ...loopSteps, ...stop], required);
        if (this.capabilityRegistry?.assertAvailable) this.capabilityRegistry.assertAvailable([...required], `workflow:${id}`);
        const serverProfiles = Array.isArray(value.serverProfiles) && value.serverProfiles.length
            ? [...new Set(value.serverProfiles.map(String).map(item => item.trim()).filter(Boolean))]
            : ['minerua'];
        if (!serverProfiles.includes(String(this.serverProfile)) && !serverProfiles.includes('generic')) {
            throw workflowError('WORKFLOW_SERVER_PROFILE_MISMATCH', `Workflow không tương thích server profile: ${this.serverProfile}.`);
        }
        const resourceBudget = normalizeBudget(value.resourceBudget, this);
        const requestedResources = Array.isArray(value.requestedResources) && value.requestedResources.length ? [...new Set(value.requestedResources.map(String).map(item => item.trim()).filter(Boolean))] : ['primary-mode'];
        for (const resource of requestedResources) if (!RESOURCE_ID.test(resource)) throw new TypeError(`Resource ID không hợp lệ: ${resource}.`);
        return Object.freeze({
            id,
            label,
            description: value.description == null ? '' : String(value.description),
            enabled: value.enabled !== false,
            primary: value.primary !== false,
            durable: value.durable !== false,
            schemaVersion: WorkflowSchemaMigrator.CURRENT_SCHEMA_VERSION,
            serverProfiles: Object.freeze(serverProfiles.sort()),
            resourceBudget: Object.freeze(resourceBudget),
            requestedResources: Object.freeze(requestedResources.sort()),
            requiredCapabilities: Object.freeze([...required].sort()),
            workflow: Object.freeze({
                start: Object.freeze(start),
                loop: Object.freeze({
                    enabled: workflow.loop?.enabled !== false && loopSteps.length > 0,
                    intervalMs,
                    continueOnError: workflow.loop?.continueOnError === true,
                    steps: Object.freeze(loopSteps)
                }),
                stop: Object.freeze(stop)
            })
        });
    }

    validate(value) {
        try { return { valid: true, value: this.normalize(value), errors: [], diagnostics: [] }; }
        catch (error) {
            return {
                valid: false,
                value: null,
                errors: [error.message],
                diagnostics: [{ code: error.code || 'WORKFLOW_DEFINITION_INVALID', i18nKey: error.i18nKey || 'workflow.definition.invalid', message: error.message }]
            };
        }
    }

    moduleCatalog() {
        return this.modules.list();
    }

    #steps(value, path, depth) {
        if (!Array.isArray(value)) throw new TypeError(`${path} phải là array.`);
        if (value.length > this.maxSteps) throw new TypeError(`${path} vượt quá ${this.maxSteps} bước.`);
        return value.map((step, index) => this.#step(step, `${path}[${index}]`, depth));
    }

    #step(step, path, depth) {
        if (depth > this.maxDepth) throw new TypeError(`${path} lồng quá sâu.`);
        if (!step || typeof step !== 'object' || Array.isArray(step)) throw new TypeError(`${path} phải là object.`);
        const type = String(step.type || '').trim();
        if (!this.modules.has(type)) throw new TypeError(`${path}.type không được hỗ trợ: ${type || '<trống>'}.`);
        const descriptor = this.modules.require(type);
        if (!descriptor.serverProfiles.includes('generic') && !descriptor.serverProfiles.includes('minecraft-generic')
            && !descriptor.serverProfiles.includes(String(this.serverProfile))) {
            throw workflowError('WORKFLOW_MODULE_SERVER_PROFILE_MISMATCH', `${path}.type không tương thích server profile ${this.serverProfile}.`);
        }
        return normalizeStepFields(step, {
            type, path, depth, maxDepth: this.maxDepth, maxRepeat: this.maxRepeat, maxWaitMs: this.maxWaitMs,
            steps: (value, nestedPath, nestedDepth) => this.#steps(value, nestedPath, nestedDepth),
            condition: this.#condition.bind(this), slashCommand: this.#slashCommand.bind(this),
            finite: this.#finite.bind(this), number: this.#number.bind(this), integer: this.#integer.bind(this)
        });
    }

    #condition(value, path) { const condition = value && typeof value === 'object' ? { ...value } : {}; const type = String(condition.type || 'connected'); if (!['connected', 'gui-open', 'not-gui-open'].includes(type)) throw new TypeError(`${path}.type không được hỗ trợ.`); return Object.freeze({ type, guiId: condition.guiId == null ? null : String(condition.guiId) }); }
    #slashCommand(step, path) { const command = String(step.command || '').trim(); if (!command.startsWith('/')) throw new TypeError(`${path}.command phải bắt đầu bằng /.`); if (command.length > 256 || /[\r\n\0]/.test(command)) throw new TypeError(`${path}.command không hợp lệ.`); if (/^\/(?:login|register|reg|l|auth|password|changepassword|cp)\b/i.test(command)) throw new TypeError(`${path}.command không được chứa lệnh đăng nhập/mật khẩu.`); return command; }

    #collectCapabilities(steps, set) {
        for (const step of steps) {
            const cap = this.modules.require(step.type).capability;
            if (cap) set.add(cap);
            if (step.type === 'if') { this.#collectCapabilities(step.then, set); this.#collectCapabilities(step.else, set); }
            if (step.type === 'repeat') this.#collectCapabilities(step.steps, set);
        }
    }

    #finite(value, path) { const n = Number(value); if (!Number.isFinite(n)) throw new TypeError(`${path} phải là số.`); return n; }
    #number(value, path, min, max) { const n = this.#finite(value, path); if (n < min || n > max) throw new TypeError(`${path} phải trong khoảng ${min}..${max}.`); return n; }
    #integer(value, path, min, max) { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) throw new TypeError(`${path} phải là số nguyên ${min}..${max}.`); return n; }
}

function normalizeBudget(value, validator) {
    const budget = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const finite = (input, path) => {
        const number = Number(input);
        if (!Number.isFinite(number)) throw new TypeError(`${path} phải là số.`);
        return number;
    };
    const number = (input, path, min, max) => {
        const result = finite(input, path);
        if (result < min || result > max) throw new TypeError(`${path} phải trong khoảng ${min}..${max}.`);
        return result;
    };
    const integer = (input, path, min, max) => {
        const result = Number(input);
        if (!Number.isInteger(result) || result < min || result > max) throw new TypeError(`${path} phải là số nguyên ${min}..${max}.`);
        return result;
    };
    return {
        maxSteps: integer(budget.maxSteps ?? 2000, 'resourceBudget.maxSteps', 1, 100000),
        maxRepeats: integer(budget.maxRepeats ?? validator.maxRepeat, 'resourceBudget.maxRepeats', 1, 100000),
        maxWaitMs: number(budget.maxWaitMs ?? validator.maxWaitMs, 'resourceBudget.maxWaitMs', 0, 24 * 3600000),
        maxOperations: integer(budget.maxOperations ?? 1000, 'resourceBudget.maxOperations', 1, 100000)
    };
}

function workflowError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

WorkflowDefinitionValidator.ALLOWED_TYPES = Object.freeze(new WorkflowModuleCatalog().list().map(item => item.type));
module.exports = WorkflowDefinitionValidator;
