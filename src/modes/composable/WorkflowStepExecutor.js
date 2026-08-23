'use strict';

const Timeout = require('../../shared/time/Timeout');
const FlowError = require('../../shared/errors/FlowError');
const WorkflowModuleCatalog = require('./WorkflowModuleCatalog');

class WorkflowStepExecutor {
    constructor({ botId, modeId, modeContext, logger = null, onPhase = null, moduleCatalog = new WorkflowModuleCatalog() } = {}) {
        Object.assign(this, { botId, modeId, modeContext, logger, onPhase, moduleCatalog });
    }

    async executeSteps(steps, { cancellationToken, variables = {}, depth = 0 } = {}) {
        const results = [];
        for (let index = 0; index < (steps || []).length; index += 1) {
            cancellationToken?.throwIfCancelled?.();
            const step = steps[index];
            this.onPhase?.(`MODULE_${String(step.type).toUpperCase().replaceAll('-', '_')}`);
            try {
                const descriptor = this.moduleCatalog.require(step.type);
                const data = await this.execute(step, { cancellationToken, variables, depth });
                results.push(Object.freeze({ contractVersion: 1, moduleType: descriptor.type, outputType: descriptor.outputType, outcome: 'SUCCESS', data: data === undefined ? null : data }));
            } catch (error) {
                throw FlowError.wrap(error, {
                    code: 'COMPOSABLE_MODE_STEP_FAILED', subsystem: 'composable-mode', operation: this.modeId,
                    step: `${step.type}:${index}`, action: step.type, resource: this.modeId,
                    details: { stepIndex: index, type: step.type }
                });
            }
        }
        return results;
    }

    async execute(step, { cancellationToken, variables = {}, depth = 0 } = {}) {
        const generation = this.modeContext.generation();
        switch (step.type) {
            case 'command': {
                const result = await this.modeContext.capability('commands').send(step.commandKey, {
                    args: step.args || {}, confirm: step.confirm === true, timeoutMs: step.timeoutMs,
                    cancellationToken, expectedGeneration: generation
                });
                return this.#requireResult(result, `Lệnh ${step.commandKey} thất bại.`);
            }
            case 'sky-command': {
                const result = await this.modeContext.capability('sky-commands').send(step.commandId, {
                    skyId: step.skyId || null,
                    args: step.args || {},
                    cancellationToken,
                    expectedGeneration: generation
                });
                return this.#requireResult(result, `Lệnh Sky ${step.commandId} thất bại.`);
            }
            case 'slash-command':
                return this.modeContext.capability('slash-command').send(step.command, { cancellationToken, expectedGeneration: generation });
            case 'gui-click':
                return this.modeContext.capability('gui').click(step.slot, {
                    button: step.button, mode: step.mode, verifyGui: step.verifyGui,
                    timeoutMs: step.timeoutMs, cancellationToken, expectedGeneration: generation
                });
            case 'wait':
                await Timeout.delay(step.ms, { cancellationToken }); return { waitedMs: step.ms };
            case 'move':
                return this.modeContext.capability('movement').goTo({ x: step.x, y: step.y, z: step.z }, {
                    owner: this.modeId, radius: step.radius, timeoutMs: step.timeoutMs, cancellationToken
                });
            case 'home':
                return this.#requireResult(await this.modeContext.capability('island').goHome({ cancellationToken, expectedGeneration: generation }), 'Không thể /is.');
            case 'sky-join':
                return this.#requireResult(await this.modeContext.capability('skyblock').join(step.selection, { cancellationToken, expectedGeneration: generation }), 'Không thể vào Skyblock.');
            case 'close-gui':
                return { closed: await this.modeContext.capability('gui').closeCurrentWindow() };
            case 'read-storage':
                return this.#requireResult(await this.modeContext.capability('storage').read({ refresh: true, cancellationToken, expectedGeneration: generation }), 'Không đọc được /kho.');
            case 'storage-protect':
                return this.#requireResult(await this.modeContext.capability('b1-materials').protectForB5Batch({ cancellationToken, expectedGeneration: generation }), 'Bảo vệ kho thất bại.');
            case 'b5-cycle':
                return this.#requireResult(await this.modeContext.capability('b5-automation').runNext({ cancellationToken, expectedGeneration: generation }), 'Chu kỳ B5 thất bại.');
            case 'wait-gui': {
                const session = await this.modeContext.capability('gui').waitFor(step.guiId || null, step.timeoutMs, cancellationToken, generation);
                return { definitionId: session?.definitionId || null, sessionId: session?.id || null };
            }
            case 'look':
                await this.modeContext.capability('rotation').look(step.yaw, step.pitch, step.force !== false);
                return { yaw: step.yaw, pitch: step.pitch };
            case 'log':
                this.logger?.[step.level || 'info']?.(step.message || 'Workflow status', { botId: this.botId, modeId: this.modeId }); return { logged: true };
            case 'if': {
                const branch = this.#condition(step.condition) ? step.then : step.else;
                return this.executeSteps(branch || [], { cancellationToken, variables, depth: depth + 1 });
            }
            case 'repeat': {
                const iterations = [];
                for (let index = 0; index < step.count; index += 1) {
                    cancellationToken?.throwIfCancelled?.();
                    iterations.push(await this.executeSteps(step.steps || [], { cancellationToken, variables: { ...variables, repeatIndex: index }, depth: depth + 1 }));
                }
                return iterations;
            }
            default: throw new Error(`Module không được hỗ trợ: ${step.type}`);
        }
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

    #requireResult(result, fallback) {
        if (result?.success === false) throw result.error || new Error(result.message || fallback);
        return result?.data ?? result;
    }
}

module.exports = WorkflowStepExecutor;
