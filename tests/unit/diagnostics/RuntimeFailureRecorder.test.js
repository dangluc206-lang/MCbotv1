'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const EventBus = require('../../../src/core/EventBus');
const FlowError = require('../../../src/shared/errors/FlowError');
const RuntimeFailureRecorder = require('../../../src/diagnostics/runtime/RuntimeFailureRecorder');

test('RuntimeFailureRecorder persists structured error plus GUI and inventory state', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcbot-errors-'));
    const eventBus = new EventBus();
    const recorder = new RuntimeFailureRecorder({
        botId: 'bot-01',
        eventBus,
        baseDir,
        config: {
            enabled: true,
            repeatWindowMs: 100,
            maxFileMb: 1,
            maxTotalMb: 4,
            retentionDays: 14,
            cleanupIntervalMs: 0
        },
        guiManager: { describeCurrent: () => ({ windowId: 9, title: 'Craft' }) },
        inventoryObservationService: {
            async capture() {
                return {
                    capturedAt: 123,
                    views: [{
                        source: 'bot-inventory',
                        slotCount: 36,
                        emptySlotCount: 35,
                        items: [{
                            slot: 1,
                            name: 'redstone',
                            count: 15,
                            identityComponents: ['MMOITEMS_ITEM_ID:DADOTINHLUYEN']
                        }]
                    }]
                };
            }
        }
    });

    const error = new FlowError('Craft output did not change.', {
        code: 'CRAFTING_OUTPUT_NOT_VERIFIED',
        subsystem: 'crafting',
        operation: 'CraftingOperation',
        step: 'verify-output',
        action: 'verify refined_redstone',
        resource: 'refined_redstone'
    });
    await recorder.record('runtime:failure', { botId: 'bot-01', phase: 'CRAFTING', error });

    const data = JSON.parse(await fs.readFile(path.join(baseDir, 'bot-01', 'last-error.json'), 'utf8'));
    assert.equal(data.diagnostic.code, 'CRAFTING_OUTPUT_NOT_VERIFIED');
    assert.equal(data.diagnostic.step, 'verify-output');
    assert.equal(data.runtimeState.gui.windowId, 9);
    assert.equal(data.runtimeState.inventory.views[0].items[0].identityComponents[0], 'MMOITEMS_ITEM_ID:DADOTINHLUYEN');
});
