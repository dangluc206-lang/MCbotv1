'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const KhoSellOperation = require('../../../src/server-features/storage/KhoSellOperation');

function makeSession(window, source = null) {
    return {
        window,
        source,
        active: true,
        setSource(next) { this.source = next; }
    };
}

test('/kho sell opens by polling currentWindow and right-click sells 64', async () => {
    let current = null;
    let sent = null;
    let clicked = null;
    let reads = 0;
    const sellSession = makeSession({ id: 12, title: 'Kho', slots: [] });

    const operation = new KhoSellOperation({
        commandService: {
            async send(key, options) {
                sent = { key, options };
                current = sellSession; // Simulate Mineflayer currentWindow becoming available after the command.
                return { success: true };
            }
        },
        guiManager: {
            current() { return current; },
            syncCurrentWindow() { return current; },
            markCurrent(source) { if (current) current.setSource(source); return current; },
            async closeCurrentWindow() { current = null; },
            async clickAndWaitForTransition(slot, options) {
                clicked = { slot, button: options.button, mode: options.mode };
                return current;
            },
            describeCurrent() { return current ? { windowId: current.window.id, title: current.window.title } : null; }
        },
        reader: {
            read() {
                reads += 1;
                return { entries: { diamond_block: { logicalId: 'diamond_block', slot: 12, amount: reads <= 2 ? 200 : 136 } } };
            }
        },
        config: {
            guiTimeoutMs: 100,
            sell: {
                enabled: true,
                commandKey: 'storageSell',
                allowAll: false,
                resultDelayMs: 0,
                openSettleMs: 0,
                closeSettleMs: 0,
                openPollMs: 5,
                openAttempts: 1,
                itemAliases: { diamond_block: 'DIAMOND_BLOCK' }
            }
        }
    });

    const result = await operation.execute('diamond_block', { quantity: 64 });
    assert.equal(sent.key, 'storageSell');
    assert.equal(sent.options.args, undefined);
    assert.deepEqual(clicked, { slot: 12, button: 1, mode: 0 });
    assert.equal(result.beforeAmount, 200);
    assert.equal(result.afterAmount, 136);
    assert.equal(sellSession.source.command, '/kho sell');
});

test('/kho and /kho sell may look the same; opener uses command provenance, not raw/layout difference', async () => {
    const oldKhoWindow = { id: 7, title: 'Kho', slots: [] };
    const sellWindow = { id: 7, title: 'Kho', slots: [] }; // Same id/title/layout shape on purpose.
    let current = makeSession(oldKhoWindow, { command: '/kho' });
    let closeCalls = 0;
    let sendCalls = 0;

    const operation = new KhoSellOperation({
        commandService: {
            async send(key) {
                assert.equal(key, 'storageSell');
                sendCalls += 1;
                current = makeSession(sellWindow);
                return { success: true };
            }
        },
        guiManager: {
            current() { return current; },
            syncCurrentWindow() { return current; },
            markCurrent(source) { current?.setSource(source); return current; },
            async closeCurrentWindow() { closeCalls += 1; current = null; },
            async clickAndWaitForTransition() { return current; },
            describeCurrent() { return current ? { windowId: current.window.id, title: current.window.title } : null; }
        },
        reader: {
            read(window) {
                // SellGuiReader is intentionally blind to raw. The sellable entry
                // looks identical in both windows; opener must not depend on raw omission.
                return { entries: { gold_block: { logicalId: 'gold_block', slot: 21, amount: window === sellWindow ? 1000 : 1000 } } };
            }
        },
        config: {
            guiTimeoutMs: 100,
            sell: {
                enabled: true,
                commandKey: 'storageSell',
                allowAll: false,
                resultDelayMs: 0,
                openSettleMs: 0,
                closeSettleMs: 0,
                openPollMs: 5,
                openAttempts: 1,
                itemAliases: { gold_block: 'GOLD_BLOCK' }
            }
        }
    });

    // We only need to exercise opening; make the click produce a visible amount delta.
    let readCount = 0;
    operation.reader.read = () => ({ entries: { gold_block: { logicalId: 'gold_block', slot: 21, amount: ++readCount < 3 ? 1000 : 936 } } });
    const result = await operation.execute('gold_block', { quantity: 64 });

    assert.equal(closeCalls, 1);
    assert.equal(sendCalls, 1);
    assert.equal(result.skipped, false);
    assert.equal(current.source.command, '/kho sell');
});


test('/kho sell opener accepts any readable sell entry, then lets execute skip an unavailable requested form', async () => {
    let current = null;
    let sends = 0;
    const sellSession = makeSession({ id: 15, title: 'Kho', slots: [] });
    const operation = new KhoSellOperation({
        commandService: {
            async send() {
                sends += 1;
                current = sellSession;
                return { success: true };
            }
        },
        guiManager: {
            current() { return current; },
            syncCurrentWindow() { return current; },
            markCurrent(source) { current?.setSource(source); return current; },
            async closeCurrentWindow() { current = null; },
            async clickAndWaitForTransition() { throw new Error('must not click missing form'); },
            describeCurrent() { return current ? { windowId: current.window.id, title: current.window.title } : null; }
        },
        reader: {
            read() {
                return { entries: { gold_block: { logicalId: 'gold_block', slot: 21, amount: 1000 } } };
            }
        },
        config: {
            guiTimeoutMs: 100,
            sell: {
                enabled: true,
                commandKey: 'storageSell',
                allowAll: false,
                openSettleMs: 0,
                closeSettleMs: 0,
                openAfterCloseSettleMs: 0,
                openPollMs: 5,
                openAttempts: 1,
                itemAliases: { gold_ingot: 'GOLD_INGOT', gold_block: 'GOLD_BLOCK' }
            }
        }
    });

    const result = await operation.execute('gold_ingot', { quantity: 64 });
    assert.equal(sends, 2, 'a missing target gets one bounded Sell GUI refresh before it is skipped');
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'material-not-visible-in-sell-gui');
    assert.equal(result.targetRefreshAttempted, true);
    assert.deepEqual(result.availableLogicalIds, ['gold_block']);
    assert.equal(current.source.command, '/kho sell');
});

test('/kho sell refreshes a stale cross-material session once and resolves the next material from the new GUI', async () => {
    let current = null;
    let sends = 0;
    let clicks = 0;
    const staleSession = makeSession({ id: 16, title: 'Sell stale', slots: [] }, { commandKey: 'storageSell', command: '/kho sell' });
    const refreshedSession = makeSession({ id: 17, title: 'Sell refreshed', slots: [] });
    current = staleSession;
    const operation = new KhoSellOperation({
        commandService: {
            async send() {
                sends += 1;
                current = refreshedSession;
                return { success: true };
            }
        },
        guiManager: {
            current() { return current; },
            syncCurrentWindow() { return current; },
            markCurrent(source) { current?.setSource(source); return current; },
            async closeCurrentWindow() { current = null; },
            async clickAndWaitForTransition() { clicks += 1; return current; },
            describeCurrent() { return current ? { windowId: current.window.id, title: current.window.title } : null; }
        },
        reader: {
            read(window) {
                return window.id === staleSession.window.id
                    ? { entries: { redstone_block: { logicalId: 'redstone_block', slot: 11, amount: null, amountReliable: false } } }
                    : { entries: { lapis_block: { logicalId: 'lapis_block', slot: 14, amount: null, amountReliable: false } } };
            }
        },
        config: {
            guiTimeoutMs: 100,
            sell: {
                enabled: true, commandKey: 'storageSell', allowAll: false,
                resultDelayMs: 0, openSettleMs: 0, closeSettleMs: 0,
                openAfterCloseSettleMs: 0, openPollMs: 5, openAttempts: 1,
                itemAliases: { redstone_block: 'REDSTONE_BLOCK', lapis_block: 'LAPIS_BLOCK' }
            }
        }
    });

    const result = await operation.execute('lapis_block', { quantity: 64 });
    assert.equal(result.skipped, false);
    assert.equal(result.logicalId, 'lapis_block');
    assert.equal(result.slot, 14);
    assert.equal(sends, 1);
    assert.equal(clicks, 1);
});

test('SELL ALL is disabled for production B1 by default', async () => {
    const operation = new KhoSellOperation({
        commandService: {}, guiManager: {}, reader: {},
        config: { sell: { enabled: true, commandKey: 'storageSell', allowAll: false, itemAliases: { coal: 'COAL' } } }
    });
    await assert.rejects(() => operation.execute('coal', { quantity: 'ALL' }), /SELL ALL is disabled/);
});

test('legacy fast-disposable whitelist no longer bypasses the production SELL ALL guard', async () => {
    const operation = new KhoSellOperation({
        commandService: {}, guiManager: {}, reader: {},
        config: {
            sell: {
                enabled: true,
                commandKey: 'storageSell',
                allowAll: false,
                fastDisposableSellAllIds: ['lapis_block'],
                itemAliases: { lapis_block: 'LAPIS_BLOCK' }
            }
        }
    });
    await assert.rejects(() => operation.execute('lapis_block', { quantity: 'ALL' }), /SELL ALL is disabled/);
});

test('repeated sells keep one /kho sell session across source-less GUI transitions', async () => {
    let current = null;
    let sends = 0;
    let clicks = 0;
    const windows = [
        { id: 40, title: 'Sell', slots: [] },
        { id: 41, title: 'Sell', slots: [] },
        { id: 42, title: 'Sell', slots: [] }
    ];

    const operation = new KhoSellOperation({
        commandService: {
            async send(key) {
                assert.equal(key, 'storageSell');
                sends += 1;
                current = makeSession(windows[0]);
                return { success: true };
            }
        },
        guiManager: {
            current() { return current; },
            syncCurrentWindow() { return current; },
            markCurrent(source) { current?.setSource(source); return current; },
            async closeCurrentWindow() { current = null; },
            async clickAndWaitForTransition() {
                clicks += 1;
                // Server refreshes/replaces the GUI and the new Mineflayer
                // session has no source metadata. KhoSellOperation must retain
                // command ownership and re-mark it instead of reopening /kho sell.
                current = makeSession(windows[Math.min(clicks, windows.length - 1)]);
                return current;
            },
            describeCurrent() { return current ? { windowId: current.window.id, title: current.window.title } : null; }
        },
        reader: {
            read() {
                return { entries: { gold_block: { logicalId: 'gold_block', slot: 19, amount: null, amountReliable: false } } };
            }
        },
        config: {
            guiTimeoutMs: 100,
            sell: {
                enabled: true,
                commandKey: 'storageSell',
                allowAll: false,
                resultDelayMs: 0,
                openSettleMs: 0,
                closeSettleMs: 0,
                openAfterCloseSettleMs: 0,
                openPollMs: 5,
                openAttempts: 1,
                itemAliases: { gold_block: 'GOLD_BLOCK' }
            }
        }
    });

    const first = await operation.execute('gold_block', { quantity: 64 });
    const second = await operation.execute('gold_block', { quantity: 64 });
    const third = await operation.execute('gold_block', { quantity: 64 });

    assert.equal(first.skipped, false);
    assert.equal(second.skipped, false);
    assert.equal(third.skipped, false);
    assert.equal(sends, 1, 'the burst must send /kho sell only once');
    assert.equal(clicks, 3);
    assert.equal(current.source.command, '/kho sell');
    assert.equal(current.source.commandKey, 'storageSell');
});


test('close() does not close an unrelated /kho session when Sell GUI was never owned', async () => {
    let closes = 0;
    const current = makeSession({ id: 99, title: 'ᴋʜᴏ ᴄʜứᴀ', slots: [] }, { commandKey: 'storage', command: '/kho' });
    const operation = new KhoSellOperation({
        commandService: {},
        guiManager: {
            current() { return current; },
            async closeCurrentWindow() { closes += 1; }
        },
        reader: {},
        config: { sell: { commandKey: 'storageSell', closeSettleMs: 0 } }
    });

    const closed = await operation.close();
    assert.equal(closed, false);
    assert.equal(closes, 0);
});

test('close() closes an explicitly owned /kho sell session', async () => {
    let closes = 0;
    const current = makeSession({ id: 100, title: 'Kho', slots: [] }, { commandKey: 'storageSell', command: '/kho sell' });
    const operation = new KhoSellOperation({
        commandService: {},
        guiManager: {
            current() { return current; },
            async closeCurrentWindow() { closes += 1; }
        },
        reader: {},
        config: { sell: { commandKey: 'storageSell', closeSettleMs: 0 } }
    });

    const closed = await operation.close();
    assert.equal(closed, true);
    assert.equal(closes, 1);
});

test('Sell GUI transition with unreliable amount returns unverified evidence requiring fresh /kho', async () => {
    let current = null;
    const session = makeSession({ id: 301, title: 'Kho', slots: [] });
    const operation = new KhoSellOperation({
        commandService: { async send() { current = session; return { success: true }; } },
        guiManager: {
            current() { return current; }, syncCurrentWindow() { return current; },
            markCurrent(source) { current?.setSource(source); return current; },
            async closeCurrentWindow() { current = null; },
            async clickAndWaitForTransition() { return current; }
        },
        reader: { read() { return { entries: { coal_block: { logicalId: 'coal_block', slot: 11, amount: null, amountReliable: false } } }; } },
        config: { guiTimeoutMs: 100, sell: { enabled: true, commandKey: 'storageSell', allowAll: false, resultDelayMs: 0, openSettleMs: 0, closeSettleMs: 0, openPollMs: 5, openAttempts: 1, itemAliases: { coal_block: 'COAL_BLOCK' } } }
    });
    const result = await operation.execute('coal_block', { quantity: 64 });
    assert.equal(result.transitioned, true);
    assert.equal(result.semanticAcknowledged, true);
    assert.equal(result.verification.verified, false);
    assert.equal(result.verification.verifiedSoldQuantity, null);
    assert.equal(result.verification.requiresFreshStorage, true);
});

test('transition to a GUI without semantic Sell entries is never acknowledged as a 64 sale', async () => {
    let current = null;
    const sellSession = makeSession({ id: 401, title: 'Sell', slots: [] });
    const otherSession = makeSession({ id: 402, title: 'Other', slots: [] }, { commandKey: 'other' });
    const operation = new KhoSellOperation({
        commandService: { async send() { current = sellSession; return { success: true }; } },
        guiManager: {
            current() { return current; }, syncCurrentWindow() { return current; },
            markCurrent(source) { current?.setSource(source); return current; },
            async closeCurrentWindow() { current = null; },
            async clickAndWaitForTransition() { current = otherSession; return current; }
        },
        reader: {
            read(window) {
                return window.title === 'Sell'
                    ? { entries: { coal_block: { logicalId: 'coal_block', slot: 11, amount: null, amountReliable: false } } }
                    : { entries: {} };
            }
        },
        config: { guiTimeoutMs: 100, sell: { enabled: true, commandKey: 'storageSell', allowAll: false, resultDelayMs: 0, openSettleMs: 0, closeSettleMs: 0, openPollMs: 5, openAttempts: 1, itemAliases: { coal_block: 'COAL_BLOCK' } } }
    });
    await assert.rejects(
        () => operation.execute('coal_block', { quantity: 64 }),
        error => error?.code === 'KHO_SELL_GUI_IDENTITY_LOST'
    );
    assert.equal(otherSession.source.commandKey, 'other', 'unrelated GUI provenance must not be overwritten');
});

test('Sell GUI reliable partial amount returns only the observed delta as verified quantity', async () => {
    let current = null;
    let reads = 0;
    const session = makeSession({ id: 302, title: 'Kho', slots: [] });
    const operation = new KhoSellOperation({
        commandService: { async send() { current = session; return { success: true }; } },
        guiManager: {
            current() { return current; }, syncCurrentWindow() { return current; },
            markCurrent(source) { current?.setSource(source); return current; },
            async closeCurrentWindow() { current = null; },
            async clickAndWaitForTransition() { return current; }
        },
        reader: { read() { reads += 1; return { entries: { coal_block: { logicalId: 'coal_block', slot: 11, amount: reads <= 2 ? 200 : 168, amountReliable: true } } }; } },
        config: { guiTimeoutMs: 100, sell: { enabled: true, commandKey: 'storageSell', allowAll: false, resultDelayMs: 0, openSettleMs: 0, closeSettleMs: 0, openPollMs: 5, openAttempts: 1, itemAliases: { coal_block: 'COAL_BLOCK' } } }
    });
    const result = await operation.execute('coal_block', { quantity: 64 });
    assert.equal(result.verification.verified, true);
    assert.equal(result.verification.verifiedSoldQuantity, 32);
    assert.equal(result.verification.requestedQuantity, 64);
    assert.equal(result.amountDelta, 32);
});
