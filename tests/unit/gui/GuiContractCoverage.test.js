'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const BotContext = require('../../../src/bot/BotContext');
const EventBus = require('../../../src/core/EventBus');
const GuiState = require('../../../src/gui/GuiState');
const GuiManager = require('../../../src/gui/GuiManager');
const GuiSession = require('../../../src/gui/GuiSession');
const ClickQueue = require('../../../src/gui/click/ClickQueue');
const ClickGuard = require('../../../src/gui/click/ClickGuard');
const ClickExecutor = require('../../../src/gui/click/ClickExecutor');
const ClickVerifier = require('../../../src/gui/click/ClickVerifier');
const SlotValidator = require('../../../src/gui/slots/SlotValidator');
const CancellationSource = require('../../../src/shared/cancellation/CancellationSource');

function window(id = 1) {
    const value = new EventEmitter();
    value.id = id;
    value.title = `window-${id}`;
    value.type = 'generic';
    value.slots = [{ name: 'paper' }, null, { name: 'coal' }];
    value.inventoryStart = 1;
    value.inventoryEnd = 2;
    return value;
}

function client() {
    const value = new EventEmitter();
    value.currentWindow = null;
    value.clickCalls = [];
    value.closeCalls = [];
    value.clickWindow = async (...args) => { value.clickCalls.push(args); };
    value.closeWindow = target => { value.closeCalls.push(target); value.currentWindow = null; };
    return value;
}

function harness({ withLogger = false } = {}) {
    const context = new BotContext('bot-01');
    const bot = client();
    context.attach(bot);
    const eventBus = new EventBus();
    const state = new GuiState();
    const clickQueue = new ClickQueue({ maxPending: 8 });
    const clickGuard = new ClickGuard({ context, slotValidator: new SlotValidator() });
    const clickExecutor = new ClickExecutor({ context });
    const clickVerifier = new ClickVerifier({ eventBus, context });
    const logs = [];
    const manager = new GuiManager({
        botId: 'bot-01', context, state,
        detector: { detect: target => target?.detected ? { id: target.detected } : null },
        clickQueue, clickGuard, clickExecutor, clickVerifier, eventBus,
        logger: withLogger ? { info: (...args) => logs.push(args) } : null
    });
    return { context, bot, eventBus, state, clickQueue, clickGuard, clickExecutor, clickVerifier, manager, logs };
}

test('GuiManager lifecycle binds exact generation, tracks source/state and closes deterministic current window', async () => {
    const h = harness({ withLogger: true });
    await h.manager.initialize();
    const first = window(1);
    first.detected = 'storage';
    h.bot.currentWindow = first;
    h.bot.emit('windowOpen', first);
    assert.equal(h.manager.current().definitionId, 'storage');
    assert.equal(h.manager.describeCurrent().connectionGeneration, 1);
    assert.equal(h.manager.markCurrent({ command: '/kho' }).source.command, '/kho');
    assert.equal(h.manager.syncCurrentWindow().window, first);
    assert.equal(await h.manager.closeCurrentWindow(), true);
    assert.equal(h.manager.current(), null);
    assert.equal(h.bot.closeCalls.length, 1);
    assert.equal(await h.manager.closeCurrentWindow(), false);
    assert.ok(h.logs.length >= 2);
    await h.manager.destroy();
});

test('GuiManager waitFor rejects stale/generation-less events and resolves only the current generation', async () => {
    const h = harness();
    const pending = h.manager.waitFor('target', 100, null, 1);
    h.eventBus.emit('gui:opened', { botId: 'bot-01', connectionGeneration: 2, definitionId: 'target', sessionId: 'stale' });
    h.eventBus.emit('gui:opened', { botId: 'bot-01', definitionId: 'target', sessionId: 'missing-generation' });
    const target = window(2); target.detected = 'target'; h.bot.currentWindow = target; h.manager.open(target);
    assert.equal((await pending).window, target);

    const disconnected = h.manager.waitFor('next', 100, null, 1);
    h.eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 1 });
    await assert.rejects(disconnected, error => error.code === 'GUI_WAIT_DISCONNECTED');

    h.manager.close();
    const source = new CancellationSource();
    const cancelled = h.manager.waitFor('next', 100, source.token, 1);
    source.cancel('stop wait');
    await assert.rejects(cancelled, error => error.code === 'CANCELLED');
    await h.manager.stop();
});

test('GuiManager waitForFresh handles in-place update, new session, disconnect and cancellation', async () => {
    const h = harness();
    const first = window(1); h.bot.currentWindow = first; const session = h.manager.open(first);
    const update = h.manager.waitForFresh(null, { afterSessionId: session.id, afterUpdateAt: 0, timeoutMs: 100, expectedGeneration: 1 });
    h.manager.update(session.id);
    assert.equal((await update).id, session.id);

    const fresh = h.manager.waitForFresh(null, { afterSessionId: session.id, timeoutMs: 100, expectedGeneration: 1 });
    const second = window(2); h.bot.currentWindow = second; h.manager.open(second);
    assert.notEqual((await fresh).id, session.id);

    h.manager.close();
    const disconnected = h.manager.waitForFresh('x', { timeoutMs: 100, expectedGeneration: 1 });
    h.eventBus.emit('connection:ended', { botId: 'bot-01', connectionGeneration: 1 });
    await assert.rejects(disconnected, error => error.code === 'GUI_WAIT_DISCONNECTED');

    const source = new CancellationSource();
    const cancelled = h.manager.waitForFresh('x', { timeoutMs: 100, cancellationToken: source.token, expectedGeneration: 1 });
    source.cancel('cancel fresh wait');
    await assert.rejects(cancelled, /cancel fresh wait/);
    await h.manager.stop();
});

test('GuiManager transition/open failures cancel pre-bound waiters and preserve FlowError diagnostics', async () => {
    const h = harness();
    await assert.rejects(
        h.manager.performAndWaitForOpen(async () => ({ success: false, message: 'open failed' }), { timeoutMs: 50, expectedGeneration: 1, label: 'open-fail' }),
        error => error.code === 'GUI_OPEN_FAILED'
    );

    const current = window(1); h.bot.currentWindow = current; h.manager.open(current);
    await assert.rejects(
        h.manager.performAndWaitForTransition(async () => ({ success: false, message: 'transition failed' }), { timeoutMs: 50, expectedGeneration: 1, label: 'transition-fail' }),
        error => error.code === 'GUI_TRANSITION_FAILED'
    );
    await h.manager.stop();
});

test('GuiManager semantic wait retries bounded, adopts current window and preserves predicate errors until success', async () => {
    const h = harness();
    let attempts = 0;
    let predicates = 0;
    const result = await h.manager.performAndWaitForSemantic(async ({ attempt }) => {
        attempts = attempt;
        const target = window(attempt);
        h.bot.currentWindow = target;
        return { success: true, attempt };
    }, {
        expectedGeneration: 1,
        timeoutMs: 25,
        pollMs: 1,
        settleMs: 0,
        attempts: 2,
        closeBeforeRetry: true,
        label: 'semantic',
        source: { command: '/semantic' },
        accept: async session => {
            predicates += 1;
            if (attempts === 1) throw new Error('predicate not ready');
            return session.window.id === 2;
        }
    });
    assert.equal(result.attempt, 2);
    assert.equal(result.session.source.command, '/semantic');
    assert.ok(predicates >= 2);
    await h.manager.stop();
});

test('GuiManager semantic wait reports bounded timeout and stale generation', async () => {
    const h = harness();
    await assert.rejects(
        h.manager.performAndWaitForSemantic(async () => ({ success: true }), {
            expectedGeneration: 1, timeoutMs: 5, pollMs: 1, settleMs: 0, attempts: 1,
            label: 'semantic-timeout', accept: () => false
        }),
        error => error.code === 'GUI_SEMANTIC_TIMEOUT'
    );

    const replacement = client();
    const pending = h.manager.performAndWaitForOpen(async () => {
        h.context.detach(h.bot);
        h.context.attach(replacement);
        return { success: true };
    }, { expectedGeneration: 1, timeoutMs: 50, label: 'stale-open' });
    await assert.rejects(pending, error => error.code === 'GUI_STALE_GENERATION');
    await h.manager.stop();
});

test('GuiManager click verifies GUI success and disposes verification when transport fails', async () => {
    const h = harness({ withLogger: true });
    const target = window(1); h.bot.currentWindow = target; const session = h.manager.open(target);
    h.bot.clickWindow = async (...args) => {
        h.bot.clickCalls.push(args);
        setImmediate(() => h.eventBus.emit('gui:updated', { botId: 'bot-01', connectionGeneration: 1, sessionId: session.id }));
    };
    const clicked = await h.manager.click(0, { verifyGui: true, expectedGeneration: 1, timeoutMs: 100, button: 1, mode: 0 });
    assert.deepEqual(clicked, { slot: 0, button: 1, mode: 0 });
    assert.equal(h.bot.clickCalls.length, 1);

    h.bot.clickWindow = async () => { throw new Error('transport failed'); };
    await assert.rejects(h.manager.click(0, { verifyGui: true, expectedGeneration: 1, timeoutMs: 100 }), error => error.code === 'GUI_CLICK_VERIFY_FAILED');
    h.manager.close();
    await assert.rejects(h.manager.click(0), error => error.code === 'GUI_NOT_OPEN');
    await h.manager.stop();
});

test('GuiManager verifyGui accepts a real replacement window after the clicked session is invalidated', async () => {
    const h = harness();
    const first = window(1);
    const second = window(2);
    h.bot.currentWindow = first;
    h.manager.open(first);
    h.clickExecutor.click = async () => {
        h.bot.currentWindow = second;
        h.manager.open(second);
        return { clicked: true };
    };

    const result = await h.manager.click(0, { verifyGui: true, expectedGeneration: 1, timeoutMs: 5 });
    assert.deepEqual(result, { clicked: true });
    assert.equal(h.manager.current().window, second);
    await h.manager.stop();
});

test('GuiManager verifyGui accepts a real close after the clicked session is invalidated', async () => {
    const h = harness();
    const first = window(1);
    h.bot.currentWindow = first;
    h.manager.open(first);
    h.clickExecutor.click = async () => {
        h.bot.currentWindow = null;
        h.manager.close();
        return { clicked: true };
    };

    const result = await h.manager.click(0, { verifyGui: true, expectedGeneration: 1, timeoutMs: 5 });
    assert.deepEqual(result, { clicked: true });
    assert.equal(h.manager.current(), null);
    await h.manager.stop();
});

test('GuiManager verifyGui reconciles an already-visible replacement currentWindow when bridge events are missed', async () => {
    const h = harness();
    const first = window(1);
    const second = window(2);
    h.bot.currentWindow = first;
    h.manager.open(first);
    h.clickExecutor.click = async () => {
        h.bot.currentWindow = second;
        return { clicked: true };
    };

    const result = await h.manager.click(0, { verifyGui: true, expectedGeneration: 1, timeoutMs: 1 });
    assert.deepEqual(result, { clicked: true });
    assert.equal(h.manager.current().window, second);
    await h.manager.stop();
});

test('GuiManager verifyGui reconciles an already-visible close when bridge events are missed', async () => {
    const h = harness();
    const first = window(1);
    h.bot.currentWindow = first;
    h.manager.open(first);
    h.clickExecutor.click = async () => {
        h.bot.currentWindow = null;
        return { clicked: true };
    };

    const result = await h.manager.click(0, { verifyGui: true, expectedGeneration: 1, timeoutMs: 1 });
    assert.deepEqual(result, { clicked: true });
    assert.equal(h.manager.current(), null);
    await h.manager.stop();
});

test('ClickGuard and ClickExecutor reject stale client/window/generation and invalid slots before side effect', async () => {
    const h = harness();
    const first = window(1); h.bot.currentWindow = first;
    const session = new GuiSession({ botId: 'bot-01', connectionGeneration: 1, client: h.bot, window: first });
    assert.throws(() => h.clickGuard.assert({ session, slot: 99, expectedGeneration: 1, capturedClient: h.bot }), RangeError);

    const replacement = client(); replacement.currentWindow = first;
    h.context.detach(h.bot); h.context.attach(replacement);
    assert.throws(() => h.clickGuard.assert({ session, slot: 0, expectedGeneration: 1, capturedClient: h.bot }), /client changed/);
    await assert.rejects(h.clickExecutor.click({ slot: 0, expectedGeneration: 1, capturedClient: h.bot, capturedWindow: first }), error => error.code === 'GUI_CLICK_STALE_GENERATION');

    const second = window(2); replacement.currentWindow = second;
    await assert.rejects(h.clickExecutor.click({ slot: 0, expectedGeneration: 2, capturedClient: replacement, capturedWindow: first }), error => error.code === 'GUI_CLICK_STALE_WINDOW');
});

test('ClickVerifier covers no-bus, open/close, external cancel, token cancel and timeout cleanup', async () => {
    const noBus = new ClickVerifier({ eventBus: null });
    assert.equal(await noBus.verify({}), true);

    const h = harness();
    const target = window(1); h.bot.currentWindow = target; const session = h.manager.open(target);
    const opened = h.clickVerifier.arm({ botId: 'bot-01', session, timeoutMs: 100, expectedGeneration: 1 });
    h.eventBus.emit('gui:opened', { botId: 'bot-01', connectionGeneration: 1, sessionId: 'new' });
    assert.equal(await opened.promise, true);

    const closed = h.clickVerifier.arm({ botId: 'bot-01', session, timeoutMs: 100, expectedGeneration: 1 });
    h.eventBus.emit('gui:closed', { botId: 'bot-01', connectionGeneration: 1, sessionId: session.id });
    assert.equal(await closed.promise, true);

    const external = h.clickVerifier.arm({ botId: 'bot-01', session, timeoutMs: 100, expectedGeneration: 1 });
    assert.equal(external.cancel('manual'), true);
    assert.equal(external.cancel('again'), false);
    await assert.rejects(external.promise, error => error.code === 'CANCELLED');

    const source = new CancellationSource();
    const cancelled = h.clickVerifier.arm({ botId: 'bot-01', session, timeoutMs: 100, expectedGeneration: 1, cancellationToken: source.token });
    source.cancel('token cancel');
    await assert.rejects(cancelled.promise, error => error.code === 'CANCELLED');

    const timed = h.clickVerifier.arm({ botId: 'bot-01', session, timeoutMs: 5, expectedGeneration: 1, acceptWindowChange: false });
    await assert.rejects(timed.promise, error => error.code === 'TIMEOUT');
    await h.manager.stop();
});

test('GuiSession rejects legacy generation constructor input outside EventEnvelope boundary', () => {
    assert.throws(() => new GuiSession({ botId: 'bot-01', generation: 1, window: { slots: [] } }), /connectionGeneration must be a positive integer/);
});
