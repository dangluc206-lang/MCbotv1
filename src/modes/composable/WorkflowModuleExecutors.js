'use strict';

const Timeout = require('../../shared/time/Timeout');

function resultOrThrow(result, fallback) {
    if (result?.success === false) throw result.error || new Error(result.message || fallback);
    return result?.data ?? result;
}

function createBuiltinExecutors() {
    const execute = (handler, { operations = false } = {}) => ({
        async execute(step, context) {
            if (operations) context.budget.operation();
            return handler(step, context);
        }
    });
    const generation = context => context.modeContext.generation();
    return {
        command: execute((step, context) => context.modeContext.capability('commands').send(step.commandKey, {
            args: step.args || {}, confirm: step.confirm === true, timeoutMs: step.timeoutMs,
            cancellationToken: context.cancellationToken, expectedGeneration: generation(context)
        }).then(result => resultOrThrow(result, `Lệnh ${step.commandKey} thất bại.`)), { operations: true }),
        'sky-command': execute((step, context) => context.modeContext.capability('sky-commands').send(step.commandId, {
            skyId: step.skyId || null, args: step.args || {}, cancellationToken: context.cancellationToken,
            expectedGeneration: generation(context)
        }).then(result => resultOrThrow(result, `Lệnh Sky ${step.commandId} thất bại.`)), { operations: true }),
        'slash-command': execute((step, context) => context.modeContext.capability('slash-command').send(step.command, {
            cancellationToken: context.cancellationToken, expectedGeneration: generation(context)
        }), { operations: true }),
        'gui-click': execute((step, context) => context.modeContext.capability('gui').click(step.slot, {
            button: step.button, mode: step.mode, verifyGui: step.verifyGui, timeoutMs: step.timeoutMs,
            cancellationToken: context.cancellationToken, expectedGeneration: generation(context)
        }), { operations: true }),
        wait: execute(async (step, context) => {
            context.budget.wait(step.ms);
            await Timeout.delay(step.ms, { cancellationToken: context.cancellationToken });
            return { waitedMs: step.ms };
        }),
        move: execute((step, context) => context.modeContext.capability('movement').goTo(
            { x: step.x, y: step.y, z: step.z },
            { owner: context.modeId, radius: step.radius, timeoutMs: step.timeoutMs, cancellationToken: context.cancellationToken }
        ), { operations: true }),
        home: execute((step, context) => context.modeContext.capability('island').goHome({
            cancellationToken: context.cancellationToken, expectedGeneration: generation(context)
        }).then(result => resultOrThrow(result, 'Không thể /is.')), { operations: true }),
        'sky-join': execute((step, context) => context.modeContext.capability('skyblock').join(step.selection, {
            cancellationToken: context.cancellationToken, expectedGeneration: generation(context)
        }).then(result => resultOrThrow(result, 'Không thể vào Skyblock.')), { operations: true }),
        'close-gui': execute((step, context) => ({ closed: context.modeContext.capability('gui').closeCurrentWindow() })),
        'read-storage': execute((step, context) => context.modeContext.capability('storage').read({
            refresh: true, cancellationToken: context.cancellationToken, expectedGeneration: generation(context)
        }).then(result => resultOrThrow(result, 'Không đọc được /kho.')), { operations: true }),
        'storage-protect': execute((step, context) => context.modeContext.capability('b1-materials').protectForB5Batch({
            cancellationToken: context.cancellationToken, expectedGeneration: generation(context)
        }).then(result => resultOrThrow(result, 'Bảo vệ kho thất bại.')), { operations: true }),
        'b5-cycle': execute((step, context) => context.modeContext.capability('b5-automation').runNext({
            cancellationToken: context.cancellationToken, expectedGeneration: generation(context)
        }).then(result => resultOrThrow(result, 'Chu kỳ B5 thất bại.')), { operations: true }),
        'wait-gui': execute(async (step, context) => {
            const session = await context.modeContext.capability('gui').waitFor(step.guiId || null, step.timeoutMs, context.cancellationToken, generation(context));
            return { definitionId: session?.definitionId || null, sessionId: session?.id || null };
        }, { operations: true }),
        look: execute(async (step, context) => {
            context.modeContext.capability('rotation').look(step.yaw, step.pitch, step.force !== false);
            return { yaw: step.yaw, pitch: step.pitch };
        }),
        log: execute((step, context) => {
            context.logger?.[step.level || 'info']?.(step.message || 'Workflow status', { botId: context.botId, modeId: context.modeId });
            return { logged: true };
        }),
        if: execute((step, context) => {
            const branch = context.condition(step.condition) ? step.then : step.else;
            return context.executeSteps(branch || [], context);
        }),
        repeat: execute(async (step, context) => {
            context.budget.repeat(step.count);
            const iterations = [];
            for (let index = 0; index < step.count; index += 1) {
                context.cancellationToken?.throwIfCancelled?.();
                iterations.push(await context.executeSteps(step.steps || [], {
                    ...context, variables: { ...context.variables, repeatIndex: index }, depth: context.depth + 1
                }));
            }
            return iterations;
        })
    };
}

module.exports = { createBuiltinExecutors };
