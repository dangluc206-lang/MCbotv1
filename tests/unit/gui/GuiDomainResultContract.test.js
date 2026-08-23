'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const BotContext = require('../../../src/bot/BotContext');
const EventBus = require('../../../src/core/EventBus');
const GuiState = require('../../../src/gui/GuiState');
const GuiManager = require('../../../src/gui/GuiManager');
const ClickQueue = require('../../../src/gui/click/ClickQueue');
const ClickGuard = require('../../../src/gui/click/ClickGuard');
const ClickExecutor = require('../../../src/gui/click/ClickExecutor');
const ClickVerifier = require('../../../src/gui/click/ClickVerifier');
const SlotValidator = require('../../../src/gui/slots/SlotValidator');
const CancellationSource = require('../../../src/shared/cancellation/CancellationSource');
const Operation = require('../../../src/operations/Operation');
const OperationManager = require('../../../src/operations/OperationManager');
const OperationQueue = require('../../../src/operations/OperationQueue');
const OperationLockPolicy = require('../../../src/operations/OperationLockPolicy');
const OperationTimeoutPolicy = require('../../../src/operations/OperationTimeoutPolicy');
const Status = require('../../../src/shared/result/Status');

function deferred() { let resolve; const promise = new Promise(res => { resolve = res; }); return { promise, resolve }; }
function win(id = 1) { const w = new EventEmitter(); Object.assign(w, { id, title: `w${id}`, type: 'generic', slots: [{ name: 'paper' }, null] }); return w; }
function client() { const c = new EventEmitter(); c.currentWindow = null; c.clickCalls = []; c.clickWindow = async (...args) => { c.clickCalls.push(args); }; return c; }
function harness() {
    const context = new BotContext('bot-01');
    const oldClient = client(); context.attach(oldClient);
    const eventBus = new EventBus();
    const queue = new ClickQueue({ maxPending: 8 });
    const manager = new GuiManager({
        botId: 'bot-01', context, state: new GuiState(), detector: { detect: () => null }, eventBus,
        clickQueue: queue, clickGuard: new ClickGuard({ context, slotValidator: new SlotValidator() }),
        clickExecutor: new ClickExecutor({ context }), clickVerifier: new ClickVerifier({ eventBus, context })
    });
    const operationManager = new OperationManager({
        botId: 'bot-01', queue: new OperationQueue({ maxPending: 8 }), lockPolicy: new OperationLockPolicy(),
        timeoutPolicy: new OperationTimeoutPolicy(), config: { defaultQueueWaitTimeoutMs: 100, defaultExecutionTimeoutMs: 200, shutdownDrainTimeoutMs: 100 }
    });
    const run = execute => operationManager.run(new Operation({ name: 'gui-domain-test', execute }), { timeoutMs: 150, connectionGeneration: 1 });
    return { context, oldClient, eventBus, queue, manager, operationManager, run };
}

async function replace(h) {
    const replacement = client();
    h.context.detach(h.oldClient); h.context.attach(replacement);
    return replacement;
}

test('GuiManager open replacement race preserves GUI_STALE_GENERATION and managed DISCONNECTED', async () => {
    const h = harness();
    const result = await h.run(async () => h.manager.performAndWaitForOpen(async () => { await replace(h); return { success: true }; }, { expectedGeneration: 1, timeoutMs: 50 }));
    assert.equal(result.status, Status.DISCONNECTED);
    assert.equal(result.error.code, 'GUI_STALE_GENERATION');
});

test('GuiManager matching connection end remains GUI_WAIT_DISCONNECTED and managed DISCONNECTED', async () => {
    const h = harness();
    const result = await h.run(async () => h.manager.performAndWaitForOpen(async () => {
        setImmediate(() => h.eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 1 }));
        return { success: true };
    }, { expectedGeneration: 1, timeoutMs: 100 }));
    assert.equal(result.status, Status.DISCONNECTED);
    assert.equal(result.error.code, 'GUI_WAIT_DISCONNECTED');
});

test('GuiManager semantic replacement and cancellation preserve DISCONNECTED/CANCELLED instead of timeout', async () => {
    const stale = harness();
    const staleResult = await stale.run(async () => stale.manager.performAndWaitForSemantic(async () => { await replace(stale); return { success: true }; }, {
        expectedGeneration: 1, timeoutMs: 20, settleMs: 0, pollMs: 1, accept: () => false
    }));
    assert.equal(staleResult.status, Status.DISCONNECTED);
    assert.equal(staleResult.error.code, 'GUI_STALE_GENERATION');

    const cancelled = harness();
    const source = new CancellationSource();
    const cancelledResult = await cancelled.run(async () => cancelled.manager.performAndWaitForSemantic(async () => {
        source.cancel('semantic cancelled'); return { success: true };
    }, { expectedGeneration: 1, timeoutMs: 20, settleMs: 0, pollMs: 1, cancellationToken: source.token, accept: () => false }));
    assert.equal(cancelledResult.status, Status.CANCELLED);
    assert.equal(cancelledResult.error.code, 'CANCELLED');
});

test('GuiManager true semantic deadline maps TIMEOUT while generic open action remains FAILED/GUI_OPEN_FAILED', async () => {
    const timeout = harness();
    const timeoutResult = await timeout.run(async () => timeout.manager.performAndWaitForSemantic(async () => ({ success: true }), {
        expectedGeneration: 1, timeoutMs: 4, settleMs: 0, pollMs: 1, accept: () => false
    }));
    assert.equal(timeoutResult.status, Status.TIMEOUT);
    assert.equal(timeoutResult.error.code, 'GUI_SEMANTIC_TIMEOUT');

    const generic = harness();
    const genericResult = await generic.run(async () => generic.manager.performAndWaitForOpen(async () => { throw new Error('plain open failure'); }, {
        expectedGeneration: 1, timeoutMs: 20
    }));
    assert.equal(genericResult.status, Status.FAILED);
    assert.equal(genericResult.error.code, 'GUI_OPEN_FAILED');
});

test('GuiManager queued replacement click is DISCONNECTED and never clicks replacement', async () => {
    const h = harness();
    const window = win(1); h.oldClient.currentWindow = window; h.manager.open(window, { client: h.oldClient, connectionGeneration: 1 });
    const blocker = deferred(); const blocked = h.queue.enqueue(() => blocker.promise, { id: 'blocker' });
    await new Promise(resolve => setImmediate(resolve));
    const pending = h.run(async () => h.manager.click(0, { expectedGeneration: 1 }));
    await new Promise(resolve => setImmediate(resolve));
    const replacement = await replace(h); blocker.resolve(); await blocked;
    const result = await pending;
    assert.equal(result.status, Status.DISCONNECTED);
    assert.equal(result.error.code, 'GUI_CLICK_STALE_GENERATION');
    assert.equal(h.oldClient.clickCalls.length, 0);
    assert.equal(replacement.clickCalls.length, 0);
});

test('GuiManager click cancellation and verification failure preserve CANCELLED and VERIFICATION_FAILED', async () => {
    const cancelled = harness();
    const window = win(1); cancelled.oldClient.currentWindow = window; cancelled.manager.open(window, { client: cancelled.oldClient, connectionGeneration: 1 });
    const source = new CancellationSource(); source.cancel('click cancelled');
    const cancelledResult = await cancelled.run(async () => cancelled.manager.click(0, { expectedGeneration: 1, cancellationToken: source.token }));
    assert.equal(cancelledResult.status, Status.CANCELLED);
    assert.equal(cancelledResult.error.code, 'CANCELLED');

    const verify = harness();
    const verifyWindow = win(1); verify.oldClient.currentWindow = verifyWindow; verify.manager.open(verifyWindow, { client: verify.oldClient, connectionGeneration: 1 });
    verify.oldClient.clickWindow = async () => { throw new Error('transport failed before GUI verification'); };
    const verifyResult = await verify.run(async () => verify.manager.click(0, { expectedGeneration: 1, verifyGui: true, timeoutMs: 50 }));
    assert.equal(verifyResult.status, Status.VERIFICATION_FAILED);
    assert.equal(verifyResult.error.code, 'GUI_CLICK_VERIFY_FAILED');
});
