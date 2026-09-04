'use strict';

function normalizeStepFields(step, { type, path, depth, maxDepth, maxRepeat, maxWaitMs, steps, condition, slashCommand, finite, number, integer }) {
    const normalized = { type };
    switch (type) {
    case 'command':
        if (!String(step.commandKey || '').trim()) throw new TypeError(`${path}.commandKey là bắt buộc.`);
        normalized.commandKey = String(step.commandKey).trim();
        normalized.args = step.args && typeof step.args === 'object' && !Array.isArray(step.args) ? { ...step.args } : {};
        normalized.confirm = step.confirm === true;
        normalized.timeoutMs = number(step.timeoutMs ?? 5000, `${path}.timeoutMs`, 100, 30000);
        break;
    case 'sky-command':
        if (!String(step.commandId || '').trim()) throw new TypeError(`${path}.commandId là bắt buộc.`);
        normalized.commandId = String(step.commandId).trim();
        normalized.skyId = step.skyId == null || step.skyId === '' ? null : String(step.skyId).trim();
        normalized.args = step.args && typeof step.args === 'object' && !Array.isArray(step.args) ? { ...step.args } : {};
        break;
    case 'slash-command': normalized.command = slashCommand(step, path); break;
    case 'gui-click':
        normalized.slot = integer(step.slot, `${path}.slot`, 0, 1000);
        normalized.button = integer(step.button ?? 0, `${path}.button`, 0, 2);
        normalized.mode = integer(step.mode ?? 0, `${path}.mode`, 0, 6);
        normalized.verifyGui = step.verifyGui === true;
        normalized.timeoutMs = number(step.timeoutMs ?? 3000, `${path}.timeoutMs`, 100, 30000);
        break;
    case 'wait': normalized.ms = number(step.ms ?? 1000, `${path}.ms`, 0, maxWaitMs); break;
    case 'move':
        normalized.x = finite(step.x, `${path}.x`); normalized.y = finite(step.y, `${path}.y`); normalized.z = finite(step.z, `${path}.z`);
        normalized.radius = number(step.radius ?? 1.2, `${path}.radius`, 0.1, 100);
        normalized.timeoutMs = number(step.timeoutMs ?? 30000, `${path}.timeoutMs`, 100, maxWaitMs);
        break;
    case 'sky-join': normalized.selection = step.selection == null || step.selection === '' ? null : String(step.selection); break;
    case 'wait-gui':
        normalized.guiId = step.guiId == null || step.guiId === '' ? null : String(step.guiId);
        normalized.timeoutMs = number(step.timeoutMs ?? 5000, `${path}.timeoutMs`, 100, 30000);
        break;
    case 'look': normalized.yaw = finite(step.yaw, `${path}.yaw`); normalized.pitch = finite(step.pitch, `${path}.pitch`); normalized.force = step.force !== false; break;
    case 'log': Object.assign(normalized, normalizeLog(step)); break;
    case 'if':
        Object.assign(normalized, normalizeControl(step, { path, depth, steps, condition }));
        break;
    case 'repeat':
        Object.assign(normalized, { count: integer(step.count ?? 1, `${path}.count`, 1, maxRepeat), steps: steps(step.steps || [], `${path}.steps`, depth + 1) });
        break;
    default: break;
    }

    function normalizeLog(step) {
        return { message: String(step.message || '').slice(0, 1000), level: ['debug', 'info', 'warn', 'error'].includes(step.level) ? step.level : 'info' };
    }

    function normalizeControl(step, { path, depth, steps, condition }) {
        return {
            condition: condition(step.condition, `${path}.condition`),
            then: steps(step.then || [], `${path}.then`, depth + 1),
            else: steps(step.else || [], `${path}.else`, depth + 1)
        };
    }
    return Object.freeze(normalized);
}

module.exports = normalizeStepFields;
