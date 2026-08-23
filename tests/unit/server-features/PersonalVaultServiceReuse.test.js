'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PersonalVaultService = require('../../../src/server-features/personal-vault/PersonalVaultService');

function config() {
    return {
        commandKey: 'personalVault2',
        storageSlots: 54,
        guiTimeoutMs: 10000,
        openSettleMs: 0,
        openAttempts: 2,
        openRetryMs: 0
    };
}

test('PersonalVaultService reuses an already proven /pv 2 session without sending the command again', async () => {
    const current = {
        id: 'pv-session',
        active: true,
        source: { commandKey: 'personalVault2', command: '/pv 2' },
        window: { id: 16, title: 'ᴋʜᴏ đồ #2', slots: [] }
    };
    let sends = 0;
    let openWaits = 0;
    let observed = 0;
    const service = new PersonalVaultService({
        commandService: { async send() { sends += 1; throw new Error('must not send /pv 2 again'); } },
        guiManager: {
            current: () => current,
            syncCurrentWindow: () => current,
            async closeCurrentWindow() { current.active = false; current = null; },
            async performAndWaitForOpen() { openWaits += 1; throw new Error('must not wait for a new vault window'); },
            describeCurrent: () => ({ windowId: 16, title: 'ᴋʜᴏ đồ #2' })
        },
        reader: { read: () => ({ items: [], totals: {}, slotCount: 54, occupiedSlotCount: 0, emptySlotCount: 54 }) },
        transfer: {},
        config: config(),
        guiKnowledge: { async observe() { observed += 1; } }
    });

    const result = await service.open();
    assert.equal(result.success, true);
    assert.deepEqual(result.data, current);
    assert.equal(result.meta?.reused, true);
    assert.equal(sends, 0);
    assert.equal(openWaits, 0);
    assert.equal(observed, 1);
});

test('PersonalVaultService does not reuse an unrelated current GUI', async () => {
    let current = {
        id: 'kho-session',
        active: true,
        source: { commandKey: 'storage', command: '/kho' },
        window: { id: 15, title: 'ᴋʜᴏ ᴄʜứᴀ', slots: [] }
    };
    let sends = 0;
    let openWaits = 0;
    const opened = {
        id: 'pv-session',
        active: true,
        source: null,
        window: { id: 16, title: 'ᴋʜᴏ đồ #2', slots: [] },
        setSource(source) { this.source = source; }
    };
    const service = new PersonalVaultService({
        commandService: { async send() { sends += 1; return { success: true }; } },
        guiManager: {
            current: () => current,
            syncCurrentWindow: () => current,
            async closeCurrentWindow() { if (current) current.active = false; current = null; },
            async performAndWaitForOpen(action, { source }) {
                openWaits += 1;
                await action();
                opened.setSource(source);
                return { session: opened, actionResult: { success: true } };
            },
            describeCurrent: () => ({ windowId: 15, title: 'ᴋʜᴏ ᴄʜứᴀ' })
        },
        reader: { read: () => ({ items: [], totals: {}, slotCount: 54, occupiedSlotCount: 0, emptySlotCount: 54 }) },
        transfer: {},
        config: config()
    });

    const result = await service.open();
    assert.equal(result.success, true);
    assert.equal(result.data.id, opened.id);
    assert.equal(result.data.window.id, opened.window.id);
    assert.equal(sends, 1);
    assert.equal(openWaits, 1);
});

test('PersonalVaultService honors GuiManager post-close gate before /pv 2 when previous GUI already closed', async () => {
    let current = null;
    let gateWaited = false;
    let sends = 0;
    const opened = { id: 'pv-gated', active: true, source: null, window: { id: 22, title: 'ᴋʜᴏ đồ #2', slots: [] }, setSource(source) { this.source = source; } };
    const service = new PersonalVaultService({
        commandService: { async send() { sends += 1; assert.equal(gateWaited, true); return { success: true }; } },
        guiManager: {
            current: () => current,
            syncCurrentWindow: () => current,
            async closeCurrentWindow() {},
            async waitForPostCloseSettle(ms) { assert.equal(ms, 1000); gateWaited = true; return 300; },
            async performAndWaitForOpen(action, { source }) { await action(); opened.setSource(source); current = opened; return { session: opened }; },
            describeCurrent: () => ({ windowId: current?.window?.id ?? null, title: current?.window?.title ?? null })
        },
        reader: { read: () => ({ items: [], totals: {}, slotCount: 54, occupiedSlotCount: 0, emptySlotCount: 54 }) },
        transfer: {},
        config: { ...config(), openAfterCloseSettleMs: 1000 }
    });
    const result = await service.open();
    assert.equal(result.success, true);
    assert.equal(sends, 1);
});
