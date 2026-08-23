'use strict';
module.exports = Object.freeze({
    id: 'fake-second',
    revision: 'r-fake-second-v1',
    implementation: 'fixture',
    endpoint: Object.freeze({ host: 'fake.second.invalid', port: 25566, auth: 'offline', version: '1.21.1' }),
    catalogs: Object.freeze({
        commands: Object.freeze({ storage: '/vault open', skyblock: '/realm', login: '/auth {password}' }),
        commandResponses: Object.freeze({}),
        skyCommands: Object.freeze({ alpha: '/realm alpha' }),
        guiWindows: Object.freeze({ realmPicker: { title: { value: 'REALM PICKER', exact: true }, layout: {} }, realmConfirm: { title: { value: 'ENTER REALM', exact: true }, layout: {} }, storage: { title: { value: 'FAKE VAULT', exact: true }, layout: {} } }),
        guiIdentity: Object.freeze({ minimumConfidence: 0.62, minimumMargin: 0.08 }),
        guiSlots: Object.freeze({ storage: { close: 2 } }),
        items: Object.freeze({ vault_marker: { representations: { gui: { rules: [{ type: 'material', value: 'emerald' }] } } }, storage_capacity: { representations: { 'storage-menu': { rules: [{ type: 'material', value: 'paper' }] } } } }),
        recipes: Object.freeze({ fake_refined: { menuItemId: 'vault_marker', menuSlot: 7, inputs: { raw_fake: 8 }, output: { itemId: 'fake_refined', amount: 2 } } }),
        craftingTiers: Object.freeze({ B1: ['raw_fake'], B2: ['fake_refined'], B3: [], B4: [], B5: [] }),
        storage: Object.freeze({ resourceAmountPatterns: ['amount\\s*:?\\s*(?<value>[\\d.,]+)'], capacityIndicator: { itemId: 'storage_capacity', fallbackLimit: 123456, scanAllSlots: true } }),
        personalVault: Object.freeze({ storageSlots: [0, 1] }),
        minerals: Object.freeze({ crafting: { quantitySlots: { '1': 2, '64': 4, ALL: 6 } } }),
        mineralConversions: Object.freeze({}), smelting: Object.freeze({ recipes: {} }),
        serverTimings: Object.freeze({ postB5CooldownMs: 42000 })
    }),
    bindings: Object.freeze({
        authentication: Object.freeze({ enabled: true, commandKey: 'login', confirm: false, delayMs: 0, timeoutMs: 1000 }),
        join: Object.freeze({ commandKey: 'skyblock', entryGuiId: 'realmPicker', joinGuiId: 'realmConfirm', selections: { alpha: { slot: 3 } }, defaultSelection: 'alpha', joinSlot: 8, guiTimeoutMs: 100, clickTimeoutMs: 100, slotReadyTimeoutMs: 100, selectionSettleMs: 0, joinSettleMs: 0, postJoinTimeoutMs: 100, postJoinMinPositionDelta: 4, modeJoin: { delayMs: 0 } })
    }),
    capabilities: Object.freeze({ commands: true, gui: true, items: true, recipes: true, crafting: true, storage: true, personalVault: false, smelting: false, conversion: false, authentication: true, join: true })
});
