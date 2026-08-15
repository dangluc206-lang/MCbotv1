'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const KhoService = require('../../../src/server-features/storage/KhoService');
const Result = require('../../../src/shared/result/Result');

function session(id, items = { coal: 10 }, capacity = { used: 1, limit: 10 }) {
    return { id, active: true, window: { items, capacity }, setSource() {} };
}

function reader() {
    return {
        read(window) {
            return { items: { ...(window?.items || {}) }, capacity: window?.capacity ?? null };
        }
    };
}

function config() {
    return {
        commandKey: 'storage',
        sell: { commandKey: 'storageSell' },
        guiTimeoutMs: 30,
        openSettleMs: 0,
        refreshSettleMs: 0,
        openAttempts: 2,
        retryCloseSettleMs: 0,
        retryDelayMs: 0,
        commandPollMs: 1
    };
}

test('KhoService accepts a readable currentWindow after /kho without requiring a windowOpen event', async () => {
    let current = null;
    let sends = 0;
    const guiManager = {
        current: () => current,
        syncCurrentWindow: () => current,
        async closeCurrentWindow() { current = null; return true; }
    };
    const service = new KhoService({
        commandService: { async send(key) { sends += 1; assert.equal(key, 'storage'); current = session('kho-1', { coal: 42 }); return Result.ok(); } },
        guiManager, reader: reader(), config: config()
    });

    const result = await service.read();
    assert.equal(result.success, true);
    assert.equal(result.data.items.coal, 42);
    assert.equal(sends, 1);
});

test('KhoService reuses only the readable /kho session that it opened itself', async () => {
    let current = null;
    let sends = 0;
    const guiManager = {
        current: () => current,
        syncCurrentWindow: () => current,
        async closeCurrentWindow() { current = null; return true; }
    };
    const service = new KhoService({
        commandService: { async send() { sends += 1; current = session('kho-1', { diamond: 99 }); return Result.ok(); } },
        guiManager, reader: reader(), config: config()
    });

    const first = await service.read();
    const second = await service.read();
    assert.equal(first.success, true);
    assert.equal(second.success, true);
    assert.equal(second.data.items.diamond, 99);
    assert.equal(sends, 1);
});

test('KhoService closes an unrelated GUI before the first /kho command', async () => {
    let current = session('other', {}, null);
    let closes = 0;
    let sends = 0;
    const guiManager = {
        current: () => current,
        syncCurrentWindow: () => current,
        async closeCurrentWindow() { closes += 1; current = null; return true; }
    };
    const service = new KhoService({
        commandService: {
            async send() {
                sends += 1;
                assert.equal(current, null, '/kho must not be sent while /ks or another GUI is still open');
                current = session('kho-1', { emerald: 70 });
                return Result.ok();
            }
        },
        guiManager, reader: reader(), config: config()
    });

    const result = await service.read();
    assert.equal(result.success, true);
    assert.equal(result.data.items.emerald, 70);
    assert.equal(closes, 1);
    assert.equal(sends, 1);
});

test('KhoService refresh accepts an in-place /kho update without requiring a new window id', async () => {
    let current = null;
    let sends = 0;
    const guiManager = {
        current: () => current,
        syncCurrentWindow: () => current,
        async closeCurrentWindow() { current = null; return true; }
    };
    const service = new KhoService({
        commandService: {
            async send() {
                sends += 1;
                if (!current) current = session('kho-1', { coal: 10 });
                else current.window.items.coal = 20;
                return Result.ok();
            }
        },
        guiManager, reader: reader(), config: config()
    });

    const first = await service.read();
    const refreshed = await service.read({ refresh: true });
    assert.equal(first.success, true);
    assert.equal(refreshed.success, true);
    assert.equal(first.data.items.coal, 10);
    assert.equal(refreshed.data.items.coal, 20);
    assert.equal(sends, 2);
});


test('KhoService closes a known /kho sell session even when KhoReader can parse it as readable storage', async () => {
    let current = session('sell-1', { gold_block: 1000 }, { used: 1000, limit: 800000 });
    current.source = { commandKey: 'storageSell', command: '/kho sell' };
    let closes = 0;
    let sends = 0;
    const guiManager = {
        current: () => current,
        syncCurrentWindow: () => current,
        async closeCurrentWindow() { closes += 1; current = null; return true; }
    };
    const service = new KhoService({
        commandService: {
            async send(key) {
                sends += 1;
                assert.equal(key, 'storage');
                assert.equal(current, null, '/kho sell must be closed before sending /kho');
                current = session('kho-1', { gold_block: 900 }, { used: 900, limit: 800000 });
                return Result.ok();
            }
        },
        guiManager, reader: reader(), config: config()
    });

    const result = await service.read({ refresh: true });
    assert.equal(result.success, true);
    assert.equal(result.data.items.gold_block, 900);
    assert.equal(closes, 1);
    assert.equal(sends, 1);
});

test('KhoService does not mistake a /nung or /ks GUI containing B1 items for /kho', async () => {
    let current = session('nung-1', { coal: 64, iron_ingot: 32 }, null);
    current.source = { commandKey: 'smelting', command: '/nung' };
    let closes = 0;
    let sends = 0;
    const guiManager = {
        current: () => current,
        syncCurrentWindow: () => current,
        async closeCurrentWindow() { closes += 1; current = null; return true; }
    };
    const service = new KhoService({
        commandService: {
            async send(key) {
                sends += 1;
                assert.equal(key, 'storage');
                assert.equal(current, null, 'unrelated B1 GUI must be closed before /kho');
                current = session('kho-2', { coal: 500 }, { used: 500, limit: 800000 });
                return Result.ok();
            }
        },
        guiManager, reader: reader(), config: config()
    });

    const result = await service.read({ refresh: true });
    assert.equal(result.success, true);
    assert.equal(result.data.items.coal, 500);
    assert.equal(closes, 1);
    assert.equal(sends, 1);
});

test('KhoService waits for an unrelated GUI to actually close before sending /kho', async () => {
    let current = session('ks-1', { coal: 64 }, null);
    current.source = { commandKey: 'minerals', command: '/ks' };
    let sends = 0;
    let closes = 0;
    const guiManager = {
        current: () => current,
        syncCurrentWindow: () => current,
        async closeCurrentWindow() {
            closes += 1;
            setTimeout(() => { current = null; }, 12);
            return true;
        }
    };
    const cfg = { ...config(), commandPollMs: 10, closeConfirmTimeoutMs: 100, openAfterCloseSettleMs: 0 };
    const service = new KhoService({
        commandService: {
            async send() {
                sends += 1;
                assert.equal(current, null, '/kho must wait until the old GUI is really gone');
                current = session('kho-1', { coal: 500 }, { used: 500, limit: 800000 });
                return Result.ok();
            }
        },
        guiManager,
        reader: reader(),
        config: cfg
    });

    const result = await service.read({ refresh: true });
    assert.equal(result.success, true);
    assert.equal(result.data.items.coal, 500);
    assert.equal(closes, 1);
    assert.equal(sends, 1);
});
