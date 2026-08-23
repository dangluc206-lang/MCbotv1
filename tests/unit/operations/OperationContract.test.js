'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Operation = require('../../../src/operations/Operation');
const OperationManager = require('../../../src/operations/OperationManager');
const OperationQueue = require('../../../src/operations/OperationQueue');
const OperationLockPolicy = require('../../../src/operations/OperationLockPolicy');
const OperationTimeoutPolicy = require('../../../src/operations/OperationTimeoutPolicy');
const CancellationSource = require('../../../src/shared/cancellation/CancellationSource');
const Status = require('../../../src/shared/result/Status');
const FlowError = require('../../../src/shared/errors/FlowError');
const BotContext = require('../../../src/bot/BotContext');
const CommandGuard = require('../../../src/commands/CommandGuard');
const CommandExecutor = require('../../../src/commands/CommandExecutor');
const EventBus = require('../../../src/core/EventBus');
const GuiState = require('../../../src/gui/GuiState');
const GuiManager = require('../../../src/gui/GuiManager');
const ClickQueue = require('../../../src/gui/click/ClickQueue');
const ClickGuard = require('../../../src/gui/click/ClickGuard');
const ClickExecutor = require('../../../src/gui/click/ClickExecutor');
const ClickVerifier = require('../../../src/gui/click/ClickVerifier');
const SlotValidator = require('../../../src/gui/slots/SlotValidator');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function createManager({ maxPending = 8, config = {} } = {}) {
    const queue = new OperationQueue({ maxPending });
    const lockPolicy = new OperationLockPolicy();
    const manager = new OperationManager({
        botId: 'bot-01',
        queue,
        lockPolicy,
        timeoutPolicy: new OperationTimeoutPolicy(),
        config: {
            defaultQueueWaitTimeoutMs: 100,
            defaultExecutionTimeoutMs: 100,
            shutdownDrainTimeoutMs: 100,
            ...config
        }
    });
    return { manager, queue, lockPolicy };
}

test('OperationManager exposes QUEUED/RUNNING per run without mutable Operation status', async () => {
    const { manager } = createManager();
    const gate = deferred();
    const operation = new Operation({ name: 'same-definition', execute: async () => gate.promise });
    const first = manager.run(operation, { timeoutMs: 200 });
    await new Promise(resolve => setImmediate(resolve));
    const running = manager.snapshot();
    assert.equal(running.running, 1);
    assert.equal(running.operations[0].status, 'RUNNING');
    assert.equal(Object.hasOwn(operation, 'status'), false);
    gate.resolve('first');
    assert.equal((await first).success, true);
    assert.equal((await manager.run(new Operation({ name: 'second', execute: async () => 'second' }))).success, true);
    assert.equal(manager.snapshot().active, 0);
});

test('pending cancellation removes the queued task and never calls its executor', async () => {
    const { manager } = createManager();
    const blocker = deferred();
    const first = manager.run(new Operation({ name: 'blocker', execute: () => blocker.promise }), { timeoutMs: 500 });
    await new Promise(resolve => setImmediate(resolve));
    let calls = 0;
    const source = new CancellationSource();
    const second = manager.run(new Operation({ name: 'cancelled-pending', execute: async () => { calls += 1; } }), {
        cancellationToken: source.token,
        timeoutMs: 100
    });
    await new Promise(resolve => setImmediate(resolve));
    source.cancel('cancel pending');
    const result = await second;
    assert.equal(result.status, Status.CANCELLED);
    assert.equal(calls, 0);
    blocker.resolve();
    await first;
});

test('queue wait timeout returns TIMEOUT and never calls executor', async () => {
    const { manager } = createManager();
    const blocker = deferred();
    const first = manager.run(new Operation({ name: 'blocker', execute: () => blocker.promise }), { timeoutMs: 500 });
    await new Promise(resolve => setImmediate(resolve));
    let calls = 0;
    const result = await manager.run(new Operation({ name: 'queue-timeout', execute: async () => { calls += 1; } }), {
        queueWaitTimeoutMs: 10,
        timeoutMs: 100
    });
    assert.equal(result.status, Status.TIMEOUT);
    assert.equal(result.error?.code, 'OPERATION_QUEUE_WAIT_TIMEOUT');
    assert.equal(calls, 0);
    blocker.resolve();
    await first;
});

test('queue full returns BUSY and close is deterministic', async () => {
    const { manager } = createManager({ maxPending: 1 });
    const blocker = deferred();
    const first = manager.run(new Operation({ name: 'blocker', execute: () => blocker.promise }), { timeoutMs: 500 });
    await new Promise(resolve => setImmediate(resolve));
    const second = manager.run(new Operation({ name: 'queued', execute: async () => 2 }), { timeoutMs: 100 });
    await new Promise(resolve => setImmediate(resolve));
    const third = await manager.run(new Operation({ name: 'full', execute: async () => 3 }), { timeoutMs: 100 });
    assert.equal(third.status, Status.BUSY);
    assert.equal(third.error?.code, 'OPERATION_QUEUE_FULL');
    blocker.resolve();
    await first;
    await second;
    await manager.stop();
    const closed = await manager.run(new Operation({ name: 'closed', execute: async () => 1 }));
    assert.equal(closed.status, Status.BUSY);
    assert.equal(closed.error?.code, 'OPERATION_MANAGER_CLOSED');
});

test('one task failure does not block the next queued task', async () => {
    const { manager } = createManager();
    const failed = manager.run(new Operation({ name: 'fails', execute: async () => { throw new Error('boom'); } }));
    const next = manager.run(new Operation({ name: 'next', execute: async () => 'ok' }));
    assert.equal((await failed).status, Status.FAILED);
    assert.equal((await next).success, true);
});

test('execution timeout cancels the underlying context and observes a late rejection', async () => {
    const { manager } = createManager();
    let observedCancellation = false;
    const late = deferred();
    const operation = new Operation({
        name: 'timeout',
        execute: async context => {
            await new Promise(resolve => context.cancellation.token.onCancelled(() => { observedCancellation = true; resolve(); }));
            await late.promise;
        }
    });
    const result = await manager.run(operation, { timeoutMs: 10 });
    assert.equal(result.status, Status.TIMEOUT);
    assert.equal(observedCancellation, true);
    late.reject(new Error('late rejection'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(manager.snapshot().active, 0);
});

test('null execution timeout removes only the root deadline while preserving cancellation and child timeouts', async () => {
    const { manager } = createManager({ config: { defaultExecutionTimeoutMs: 10 } });
    const startedAt = Date.now();
    const root = new Operation({
        name: 'unbounded-root',
        execute: async context => {
            assert.equal(context.timeoutMs, null);
            assert.equal(context.remainingMs(), null);
            await new Promise(resolve => setTimeout(resolve, 25));
            const child = new Operation({
                name: 'bounded-child',
                execute: childContext => new Promise(resolve => {
                    childContext.cancellation.token.onCancelled(() => resolve('cancelled'));
                })
            });
            const childResult = await manager.run(child, { operationContext: context, timeoutMs: 5 });
            assert.equal(childResult.status, Status.TIMEOUT);
            return 'root-ok';
        }
    });
    const result = await manager.run(root, { timeoutMs: null });
    assert.equal(result.success, true);
    assert.equal(result.data, 'root-ok');
    assert.ok(Date.now() - startedAt >= 20, 'root must survive past the 10ms manager default');

    const source = new CancellationSource();
    const cancellable = manager.run(new Operation({
        name: 'unbounded-cancellable',
        execute: context => new Promise(resolve => context.cancellation.token.onCancelled(() => resolve('cancelled')))
    }), { timeoutMs: null, cancellationToken: source.token });
    await new Promise(resolve => setTimeout(resolve, 2));
    source.cancel('operator stop');
    const cancelled = await cancellable;
    assert.equal(cancelled.status, Status.CANCELLED);
});

test('authorized child runs inline and cannot deadlock behind its parent', async () => {
    const { manager } = createManager();
    const sequence = [];
    const child = new Operation({ name: 'child', lockKeys: ['storage'], execute: async context => { sequence.push(`child:${context.parentOperationId}`); return 'child-ok'; } });
    const parent = new Operation({
        name: 'parent',
        lockKeys: ['storage'],
        execute: async context => {
            sequence.push('parent-start');
            const result = await manager.run(child, { operationContext: context });
            assert.equal(result.success, true);
            sequence.push('parent-end');
            return result.data;
        }
    });
    const result = await manager.run(parent, { timeoutMs: 100 });
    assert.equal(result.success, true);
    assert.deepEqual(sequence, ['parent-start', `child:${result.meta.operationId}`, 'parent-end']);
});

test('fake operationContext and another managers context are rejected', async () => {
    const a = createManager().manager;
    const b = createManager().manager;
    const operation = new Operation({ name: 'child', execute: async () => true });
    const fake = await a.run(operation, { operationContext: { botId: 'bot-01' } });
    assert.equal(fake.status, Status.INVALID_INPUT);

    let contextFromA;
    const capture = new Operation({ name: 'capture', execute: async context => { contextFromA = context; return true; } });
    assert.equal((await a.run(capture)).success, true);
    const foreign = await b.run(operation, { operationContext: contextFromA });
    assert.equal(foreign.status, Status.INVALID_INPUT);
});

test('cleanup runs LIFO and one cleanup failure does not hide the primary result', async () => {
    const { manager } = createManager();
    const order = [];
    const operation = new Operation({
        name: 'cleanup',
        execute: async context => {
            context.registerCleanup(() => { order.push('first'); }, 'first');
            context.registerCleanup(() => { order.push('second'); throw new Error('cleanup failed'); }, 'second');
            throw new Error('primary failed');
        }
    });
    const result = await manager.run(operation);
    assert.equal(result.status, Status.FAILED);
    assert.match(result.message, /primary failed/);
    assert.deepEqual(order, ['second', 'first']);
    assert.equal(result.meta.cleanupErrors.length, 1);
    assert.equal(result.meta.cleanupErrors[0].label, 'second');
    assert.match(result.meta.cleanupErrors[0].message, /cleanup failed/);
});

test('cancelled parent makes a child return CANCELLED without throwing or running the child executor', async () => {
    const { manager } = createManager();
    let childCalls = 0;
    const child = new Operation({ name: 'child-after-cancel', execute: async () => { childCalls += 1; } });
    const parent = new Operation({
        name: 'parent-cancel-before-child',
        execute: async context => {
            context.cancel('parent cancelled before child');
            return manager.run(child, { operationContext: context });
        },
        returnsResult: true
    });
    const result = await manager.run(parent);
    assert.equal(result.status, Status.CANCELLED);
    assert.equal(childCalls, 0);
    assert.equal(manager.snapshot().active, 0);
});

test('reentrant lock depth prevents a child release from releasing its parent lock', () => {
    const policy = new OperationLockPolicy();
    const owner = policy.createOwner('root');
    const other = policy.createOwner('other');
    assert.equal(policy.acquire(['gui'], owner), true);
    assert.equal(policy.acquire(['gui'], owner), true);
    assert.equal(policy.depth('gui'), 2);
    assert.equal(policy.release(['gui'], owner), true);
    assert.equal(policy.depth('gui'), 1);
    assert.equal(policy.acquire(['gui'], other), false);
    assert.equal(policy.release(['gui'], other), false);
    assert.equal(policy.depth('gui'), 1);
    assert.equal(policy.release(['gui'], owner), true);
    assert.equal(policy.depth('gui'), 0);
});

test('multi-key acquire is all-or-nothing', () => {
    const policy = new OperationLockPolicy();
    const one = policy.createOwner('one');
    const two = policy.createOwner('two');
    assert.equal(policy.acquire(['gui'], one), true);
    assert.equal(policy.acquire(['inventory', 'gui'], two), false);
    assert.equal(policy.owner('inventory'), null);
    assert.equal(policy.owner('gui'), one.id);
});

test('cancelAll cancels both running and queued contexts without running the queued executor', async () => {
    const { manager } = createManager();
    let runningCancelled = false;
    let queuedCalls = 0;
    const running = manager.run(new Operation({
        name: 'running-cancel-all',
        execute: context => new Promise(resolve => {
            context.cancellation.token.onCancelled(() => {
                runningCancelled = true;
                resolve('cancelled');
            });
        })
    }), { timeoutMs: 500 });
    await new Promise(resolve => setImmediate(resolve));
    const queued = manager.run(new Operation({
        name: 'queued-cancel-all',
        execute: async () => { queuedCalls += 1; }
    }), { timeoutMs: 500 });
    await new Promise(resolve => setImmediate(resolve));
    manager.cancelAll('cancel all test');
    const [runningResult, queuedResult] = await Promise.all([running, queued]);
    assert.equal(runningCancelled, true);
    assert.equal(runningResult.status, Status.CANCELLED);
    assert.equal(queuedResult.status, Status.CANCELLED);
    assert.equal(queuedCalls, 0);
    assert.equal(manager.snapshot().active, 0);
});

test('OperationManager stop is bounded even when an external primitive ignores cancellation', async () => {
    const { manager, lockPolicy } = createManager({ config: { shutdownDrainTimeoutMs: 10 } });
    const gate = deferred();
    const pending = manager.run(new Operation({ name: 'ignores-cancel', lockKeys: ['gui'], execute: () => gate.promise }), { timeoutMs: 500 });
    await new Promise(resolve => setImmediate(resolve));
    const started = Date.now();
    await manager.stop();
    assert.ok(Date.now() - started < 100, 'stop must return within bounded drain time');
    assert.equal(manager.snapshot().closed, true);
    const stoppedResult = await pending;
    assert.equal(stoppedResult.status, Status.CANCELLED);
    assert.equal(lockPolicy.depth('gui'), 0, 'logical operation cancellation must release its owned lock');
    gate.resolve('late');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(lockPolicy.depth('gui'), 0);
    assert.equal(manager.snapshot().active, 0);
});

test('two bot-scoped operation managers never share queues, contexts, or lock ownership', async () => {
    const a = createManager();
    const b = createManager();
    const gate = deferred();
    const first = a.manager.run(new Operation({ name: 'bot-a', lockKeys: ['storage'], execute: () => gate.promise }));
    await new Promise(resolve => setImmediate(resolve));
    const second = await b.manager.run(new Operation({ name: 'bot-b', lockKeys: ['storage'], execute: async context => context.botId }));
    assert.equal(second.success, true);
    assert.equal(second.data, 'bot-01');
    assert.equal(a.lockPolicy.depth('storage'), 1);
    assert.equal(b.lockPolicy.depth('storage'), 0);
    gate.resolve('done');
    await first;
});

test('operation timeout cancels a throttled command so no late chat reaches old or replacement client', async () => {
    const context = new BotContext('bot-01');
    const oldClient = { chatCalls: [], chat(value) { this.chatCalls.push(value); } };
    const replacement = { chatCalls: [], chat(value) { this.chatCalls.push(value); } };
    context.attach(oldClient);
    const guard = new CommandGuard({ context, minimumIntervalMs: 60 });
    guard.markSent();
    const executor = new CommandExecutor({ context, guard });
    const { manager } = createManager();
    const operation = new Operation({
        name: 'command-timeout',
        execute: opContext => executor.execute('/is', {
            cancellationToken: opContext.cancellation.token,
            expectedGeneration: 1
        })
    });
    const result = await manager.run(operation, { timeoutMs: 10, connectionGeneration: 1 });
    assert.equal(result.status, Status.TIMEOUT);
    context.detach(oldClient);
    context.attach(replacement);
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(oldClient.chatCalls.length, 0);
    assert.equal(replacement.chatCalls.length, 0);
});

test('operation timeout cancels a queued GUI click so no late click reaches old or replacement client', async () => {
    const context = new BotContext('bot-01');
    const makeClient = () => ({
        currentWindow: null,
        clickCalls: [],
        async clickWindow(...args) { this.clickCalls.push(args); }
    });
    const oldClient = makeClient();
    context.attach(oldClient);
    const clickQueue = new ClickQueue({ maxPending: 8 });
    const eventBus = new EventBus();
    const guiManager = new GuiManager({
        botId: 'bot-01', context, state: new GuiState(), detector: { detect: () => null },
        clickQueue,
        clickGuard: new ClickGuard({ context, slotValidator: new SlotValidator() }),
        clickExecutor: new ClickExecutor({ context }),
        clickVerifier: new ClickVerifier({ eventBus, context }),
        eventBus
    });
    const window = { id: 1, title: 'test', type: 'generic', slots: [{ name: 'paper' }] };
    oldClient.currentWindow = window;
    guiManager.open(window, { client: oldClient, connectionGeneration: 1 });
    const blocker = deferred();
    const blocked = clickQueue.enqueue(() => blocker.promise, { id: 'external-blocker' });
    await new Promise(resolve => setImmediate(resolve));

    const { manager } = createManager();
    const operation = new Operation({
        name: 'click-timeout',
        execute: opContext => guiManager.click(0, {
            cancellationToken: opContext.cancellation.token,
            expectedGeneration: 1
        })
    });
    const result = await manager.run(operation, { timeoutMs: 10, connectionGeneration: 1 });
    assert.equal(result.status, Status.TIMEOUT);

    const replacement = makeClient();
    replacement.currentWindow = { id: 2, title: 'replacement', type: 'generic', slots: [{ name: 'paper' }] };
    context.detach(oldClient);
    context.attach(replacement);
    blocker.resolve();
    await blocked;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(oldClient.clickCalls.length, 0);
    assert.equal(replacement.clickCalls.length, 0);
});

test('Operation status mapping, verification and returnsResult preserve domain statuses', async () => {
    assert.throws(() => new Operation({ name: 'invalid' }), /execute is required/);
    assert.equal(Operation.statusForError({ code: 'TIMEOUT' }), Status.TIMEOUT);
    assert.equal(Operation.statusForError({ code: 'OPERATION_QUEUE_WAIT_TIMEOUT' }), Status.TIMEOUT);
    assert.equal(Operation.statusForError({ code: 'CANCELLED' }), Status.CANCELLED);
    assert.equal(Operation.statusForError({ code: 'OPERATION_QUEUE_FULL' }), Status.BUSY);
    assert.equal(Operation.statusForError({ code: 'OPERATION_MANAGER_CLOSED' }), Status.BUSY);
    assert.equal(Operation.statusForError({ code: 'OPERATION_LOCK_BUSY' }), Status.BUSY);
    assert.equal(Operation.statusForError({ code: 'OPERATION_VERIFICATION_FAILED' }), Status.VERIFICATION_FAILED);
    assert.equal(Operation.statusForError({ code: 'CRAFTING_OUTCOME_UNCERTAIN' }), Status.VERIFICATION_FAILED);
    assert.equal(Operation.statusForError({ code: 'CRAFTING_OUTPUT_NOT_VERIFIED' }), Status.VERIFICATION_FAILED);
    assert.equal(Operation.statusForError({ code: 'KHO_SELL_NOT_VERIFIED' }), Status.VERIFICATION_FAILED);
    assert.equal(Operation.statusForError({ code: 'BOT_NOT_READY' }), Status.NOT_READY);
    assert.equal(Operation.statusForError({ code: 'CRAFTING_RECIPE_NOT_FOUND' }), Status.NOT_FOUND);
    assert.equal(Operation.statusForError({ code: 'CRAFTING_QUANTITY_INVALID' }), Status.INVALID_INPUT);
    assert.equal(Operation.statusForError({ code: 'DISCONNECTED' }), Status.DISCONNECTED);
    assert.equal(Operation.statusForError({ code: 'OTHER' }), Status.FAILED);

    const { manager } = createManager();
    const verification = await manager.run(new Operation({
        name: 'verify-fail', execute: async () => ({ value: 1 }), verify: async () => false
    }));
    assert.equal(verification.status, Status.VERIFICATION_FAILED);

    const preserved = await manager.run(new Operation({
        name: 'result-return', returnsResult: true,
        execute: async () => ({ success: false, status: Status.NOT_READY, message: 'wait' })
    }));
    assert.equal(preserved.status, Status.NOT_READY);
});

test('Operation lock busy maps BUSY and lock utility branches remain deterministic', async () => {
    const { manager, lockPolicy } = createManager();
    const external = lockPolicy.createOwner('external');
    assert.equal(lockPolicy.acquire(['gui'], external), true);
    const result = await manager.run(new Operation({ name: 'needs-gui', lockKeys: ['gui'], execute: async () => true }));
    assert.equal(result.status, Status.BUSY);
    assert.equal(lockPolicy.owner('gui'), external.id);
    assert.equal(lockPolicy.depth('gui'), 1);
    assert.equal(lockPolicy.release(['gui'], {}), false);
    assert.equal(lockPolicy.clear({}), false);
    assert.equal(lockPolicy.snapshot()[0].key, 'gui');
    assert.equal(lockPolicy.clear(external), true);
    assert.equal(lockPolicy.owner('gui'), null);
    assert.equal(lockPolicy.clear(), false);
});

test('OperationQueue direct edge contracts are deterministic and drain immediately when idle', async () => {
    assert.throws(() => new OperationQueue({ maxPending: 0 }), /positive integer/);
    const queue = new OperationQueue({ maxPending: 2 });
    await assert.rejects(queue.enqueue(null), TypeError);
    const source = new CancellationSource();
    source.cancel('already cancelled');
    await assert.rejects(queue.enqueue(async () => true, { cancellationToken: source.token }), error => error.code === 'CANCELLED');
    assert.equal(queue.cancel('missing'), false);
    assert.equal(queue.cancelAll(), 0);
    assert.deepEqual(queue.snapshot().pendingIds, []);
    await queue.drain();
    await queue.destroy();
    await assert.rejects(queue.enqueue(async () => true), error => error.code === 'OPERATION_MANAGER_CLOSED');
});

test('OperationContext diagnostic/step and manager invalid/stop-timeout branches are covered without exposing mutable ownership', async () => {
    const logs = [];
    const fakeQueue = {
        pending: 0,
        close() {},
        cancelAll() { return 0; },
        cancel() { return false; },
        drain() { return new Promise(() => {}); }
    };
    const manager = new OperationManager({
        botId: 'bot-01', queue: fakeQueue, lockPolicy: new OperationLockPolicy(), timeoutPolicy: new OperationTimeoutPolicy(),
        config: { shutdownDrainTimeoutMs: 1, defaultQueueWaitTimeoutMs: 5, defaultExecutionTimeoutMs: 5 },
        logger: { warn: (...args) => logs.push(args) }
    });
    const invalid = await manager.run(null);
    assert.equal(invalid.status, Status.INVALID_INPUT);
    assert.equal(manager.cancel('missing'), false);
    assert.equal(manager.snapshot().closed, false);
    await manager.stop();
    assert.equal(logs.length, 1);

    const { manager: real } = createManager();
    const result = await real.run(new Operation({
        name: 'context-branches',
        execute: async context => {
            const remaining = context.remainingMs();
            assert.ok(remaining > 0 && remaining <= context.timeoutMs);
            assert.throws(() => context.registerCleanup(null), /cleanup must be a function/);
            context.markRunning();
            const value = await context.step('inner-step', async () => 'ok');
            assert.equal(value, 'ok');
            const diagnostic = context.diagnostic();
            assert.equal(diagnostic.operationId, context.operationId);
            assert.equal(Object.hasOwn(diagnostic, 'cancellation'), false);
            return 'done';
        }
    }), { metadata: { safe: true } });
    assert.equal(result.success, true);
});


test('settled OperationContext is revoked after SUCCESS/FAILED/CANCELLED/TIMED_OUT and child executor never runs', async () => {
    for (const terminal of ['SUCCESS', 'FAILED', 'CANCELLED', 'TIMED_OUT']) {
        const { manager } = createManager();
        let captured = null;
        let childCalls = 0;
        const child = new Operation({ name: `late-child-${terminal}`, execute: async () => { childCalls += 1; return true; } });
        let root;
        if (terminal === 'SUCCESS') {
            root = new Operation({ name: 'capture-success', execute: async context => { captured = context; return true; } });
        } else if (terminal === 'FAILED') {
            root = new Operation({ name: 'capture-failed', execute: async context => { captured = context; throw new Error('expected failure'); } });
        } else if (terminal === 'CANCELLED') {
            root = new Operation({ name: 'capture-cancelled', execute: async context => { captured = context; context.cancel('expected cancellation'); return true; } });
        } else {
            root = new Operation({
                name: 'capture-timeout',
                execute: context => {
                    captured = context;
                    return new Promise(resolve => context.cancellation.token.onCancelled(() => resolve(true)));
                }
            });
        }
        const result = await manager.run(root, { timeoutMs: terminal === 'TIMED_OUT' ? 5 : 100 });
        assert.ok(captured, `${terminal}: context captured`);
        assert.equal(captured.isLive(), false, `${terminal}: context must be revoked`);
        assert.equal(manager.isContext(captured), false, `${terminal}: manager must reject settled context`);
        const late = await manager.run(child, { operationContext: captured });
        assert.equal(late.status, Status.INVALID_INPUT, `${terminal}: stale child status`);
        assert.equal(late.error?.code, 'OPERATION_CONTEXT_STALE', `${terminal}: stale child error code`);
        assert.equal(childCalls, 0, `${terminal}: child executor calls`);
        assert.ok([Status.SUCCESS, Status.FAILED, Status.CANCELLED, Status.TIMEOUT].includes(result.status));
    }
});

test('disposed RUNNING OperationContext is revoked immediately for child execution', async () => {
    const { manager } = createManager();
    let childCalls = 0;
    const child = new Operation({ name: 'child-after-dispose', execute: async () => { childCalls += 1; } });
    const root = new Operation({
        name: 'dispose-before-child',
        returnsResult: true,
        execute: async context => {
            context.dispose();
            assert.equal(context.isDisposed(), true);
            assert.equal(context.isLive(), false);
            return manager.run(child, { operationContext: context });
        }
    });
    const result = await manager.run(root);
    assert.equal(result.status, Status.INVALID_INPUT);
    assert.equal(result.error?.code, 'OPERATION_CONTEXT_STALE');
    assert.equal(childCalls, 0);
});

test('stale context from an old root cannot bypass queue while a new root is RUNNING', async () => {
    const { manager } = createManager();
    let staleContext = null;
    await manager.run(new Operation({ name: 'old-root', execute: async context => { staleContext = context; return true; } }));

    const gate = deferred();
    let newRootRunning = false;
    const current = manager.run(new Operation({
        name: 'new-root-blocker',
        execute: async () => { newRootRunning = true; await gate.promise; newRootRunning = false; return true; }
    }), { timeoutMs: 500 });
    await new Promise(resolve => setImmediate(resolve));

    let childCalls = 0;
    let concurrent = false;
    const late = await manager.run(new Operation({
        name: 'stale-inline-child',
        execute: async () => { childCalls += 1; concurrent ||= newRootRunning; return true; }
    }), { operationContext: staleContext });

    assert.equal(late.status, Status.INVALID_INPUT);
    assert.equal(late.error?.code, 'OPERATION_CONTEXT_STALE');
    assert.equal(childCalls, 0);
    assert.equal(concurrent, false);
    assert.equal(newRootRunning, true);
    gate.resolve();
    await current;
});

test('managed root and child use deterministic explicit domain error status mapping', async () => {
    const cases = [
        ['ISLAND_STALE_GENERATION', Status.DISCONNECTED],
        ['AFK_STALE_GENERATION', Status.DISCONNECTED],
        ['GUI_WAIT_DISCONNECTED', Status.DISCONNECTED],
        ['GUI_STALE_GENERATION', Status.DISCONNECTED],
        ['DUNGEON_TELEPORT_VERIFY_TIMEOUT', Status.TIMEOUT],
        ['AFK_TELEPORT_VERIFY_TIMEOUT', Status.TIMEOUT],
        ['OPERATION_QUEUE_WAIT_TIMEOUT', Status.TIMEOUT],
        ['OPERATION_LOCK_BUSY', Status.BUSY],
        ['OPERATION_VERIFICATION_FAILED', Status.VERIFICATION_FAILED],
        ['CRAFTING_OUTCOME_UNCERTAIN', Status.VERIFICATION_FAILED],
        ['KHO_SELL_NOT_VERIFIED', Status.VERIFICATION_FAILED],
        ['BOT_NOT_READY', Status.NOT_READY],
        ['CRAFTING_RECIPE_NOT_FOUND', Status.NOT_FOUND],
        ['CRAFTING_QUANTITY_INVALID', Status.INVALID_INPUT],
        ['CANCELLED', Status.CANCELLED],
        ['SOME_UNKNOWN_DOMAIN_ERROR', Status.FAILED]
    ];
    for (const [code, expected] of cases) {
        const { manager } = createManager();
        const throwing = label => new Operation({
            name: label,
            execute: async () => { throw new FlowError(label, { code, subsystem: 'test' }); }
        });
        const root = await manager.run(throwing(`root-${code}`), { timeoutMs: 100 });
        assert.equal(root.status, expected, `root ${code}`);

        const parent = new Operation({
            name: `parent-${code}`,
            returnsResult: true,
            execute: context => manager.run(throwing(`child-${code}`), { operationContext: context })
        });
        const child = await manager.run(parent, { timeoutMs: 100 });
        assert.equal(child.status, expected, `child ${code}`);
    }
});
