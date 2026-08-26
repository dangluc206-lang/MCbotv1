'use strict';

const WorkflowModuleCatalog = require('./WorkflowModuleCatalog');
const MODE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const CONTRACT_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const RESOURCE_ID = /^[a-z][a-z0-9]*(?:[-.:][a-z0-9]+)*$/;

class WorkflowDefinitionValidator {
    constructor({ maxSteps = 200, maxDepth = 6, maxRepeat = 1000, maxWaitMs = 3600000, moduleCatalog = new WorkflowModuleCatalog() } = {}) {
        Object.assign(this, { maxSteps, maxDepth, maxRepeat, maxWaitMs });
        this.modules = moduleCatalog;
    }

    normalize(value) {
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
        const requestedResources = Array.isArray(value.requestedResources) && value.requestedResources.length ? [...new Set(value.requestedResources.map(String).map(item => item.trim()).filter(Boolean))] : ['primary-mode'];
        for (const resource of requestedResources) if (!RESOURCE_ID.test(resource)) throw new TypeError(`Resource ID không hợp lệ: ${resource}.`);
        return Object.freeze({
            id,
            label,
            description: value.description == null ? '' : String(value.description),
            enabled: value.enabled !== false,
            primary: value.primary !== false,
            durable: value.durable !== false,
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
        try { return { valid: true, value: this.normalize(value), errors: [] }; }
        catch (error) { return { valid: false, value: null, errors: [error.message] }; }
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
        // Fail closed by rebuilding from the declared schema. Unknown fields
        // (including prototype-shaped keys and removed legacy toggles) never
        // reach persistence or an executor.
        const normalized = { type };
        switch (type) {
        case 'command':
            if (!String(step.commandKey || '').trim()) throw new TypeError(`${path}.commandKey là bắt buộc.`);
            normalized.commandKey = String(step.commandKey).trim();
            normalized.args = step.args && typeof step.args === 'object' && !Array.isArray(step.args) ? { ...step.args } : {};
            normalized.confirm = step.confirm === true;
            normalized.timeoutMs = this.#number(step.timeoutMs ?? 5000, `${path}.timeoutMs`, 100, 30000);
            break;
        case 'sky-command':
            if (!String(step.commandId || '').trim()) throw new TypeError(`${path}.commandId là bắt buộc.`);
            normalized.commandId = String(step.commandId).trim();
            normalized.skyId = step.skyId == null || step.skyId === '' ? null : String(step.skyId).trim();
            normalized.args = step.args && typeof step.args === 'object' && !Array.isArray(step.args) ? { ...step.args } : {};
            break;
        case 'slash-command':
            normalized.command = this.#slashCommand(step, path);
            break;
        case 'gui-click':
            normalized.slot = this.#integer(step.slot, `${path}.slot`, 0, 1000);
            normalized.button = this.#integer(step.button ?? 0, `${path}.button`, 0, 2);
            normalized.mode = this.#integer(step.mode ?? 0, `${path}.mode`, 0, 6);
            normalized.verifyGui = step.verifyGui === true;
            normalized.timeoutMs = this.#number(step.timeoutMs ?? 3000, `${path}.timeoutMs`, 100, 30000);
            break;
        case 'wait':
            normalized.ms = this.#number(step.ms ?? 1000, `${path}.ms`, 0, this.maxWaitMs);
            break;
        case 'move':
            normalized.x = this.#finite(step.x, `${path}.x`); normalized.y = this.#finite(step.y, `${path}.y`); normalized.z = this.#finite(step.z, `${path}.z`);
            normalized.radius = this.#number(step.radius ?? 1.2, `${path}.radius`, 0.1, 100);
            normalized.timeoutMs = this.#number(step.timeoutMs ?? 30000, `${path}.timeoutMs`, 100, this.maxWaitMs);
            break;
        case 'sky-join':
            normalized.selection = step.selection == null || step.selection === '' ? null : String(step.selection);
            break;
        case 'storage-protect':
            // B5 storage protection always owns iron/gold smelting. There is no
            // per-workflow toggle because disabling smelting would violate the
            // batch-boundary contract.
            break;
        case 'wait-gui':
            normalized.guiId = step.guiId == null || step.guiId === '' ? null : String(step.guiId);
            normalized.timeoutMs = this.#number(step.timeoutMs ?? 5000, `${path}.timeoutMs`, 100, 30000);
            break;
        case 'look':
            normalized.yaw = this.#finite(step.yaw, `${path}.yaw`);
            normalized.pitch = this.#finite(step.pitch, `${path}.pitch`);
            normalized.force = step.force !== false;
            break;
        case 'log':
            normalized.message = String(step.message || '').slice(0, 1000);
            normalized.level = ['debug','info','warn','error'].includes(step.level) ? step.level : 'info';
            break;
        case 'if':
            normalized.condition = this.#condition(step.condition, `${path}.condition`);
            normalized.then = this.#steps(step.then || [], `${path}.then`, depth + 1);
            normalized.else = this.#steps(step.else || [], `${path}.else`, depth + 1);
            break;
        case 'repeat':
            normalized.count = this.#integer(step.count ?? 1, `${path}.count`, 1, this.maxRepeat);
            normalized.steps = this.#steps(step.steps || [], `${path}.steps`, depth + 1);
            break;
        default:
            break;
        }
        return Object.freeze(normalized);
    }

    #condition(value, path) {
        const condition = value && typeof value === 'object' ? { ...value } : {};
        const type = String(condition.type || 'connected');
        if (!['connected','gui-open','not-gui-open'].includes(type)) throw new TypeError(`${path}.type không được hỗ trợ.`);
        return Object.freeze({ type, guiId: condition.guiId == null ? null : String(condition.guiId) });
    }

    #slashCommand(step, path) {
        const command = String(step.command || '').trim();
        if (!command.startsWith('/')) throw new TypeError(`${path}.command phải bắt đầu bằng /.`);
        if (command.length > 256 || /[\r\n\0]/.test(command)) throw new TypeError(`${path}.command không hợp lệ.`);
        if (/^\/(?:login|register|reg|l|auth|password|changepassword|cp)\b/i.test(command)) throw new TypeError(`${path}.command không được chứa lệnh đăng nhập/mật khẩu.`);
        return command;
    }

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

WorkflowDefinitionValidator.ALLOWED_TYPES = Object.freeze(new WorkflowModuleCatalog().list().map(item => item.type));
module.exports = WorkflowDefinitionValidator;
