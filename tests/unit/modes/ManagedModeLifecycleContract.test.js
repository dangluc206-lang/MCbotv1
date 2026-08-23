'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ManagedMode = require('../../../src/modes/ManagedMode');
const ModeCatalog = require('../../../src/modes/ModeCatalog');
const ModeCoordinator = require('../../../src/modes/ModeCoordinator');
const ModeContext = require('../../../src/modes/ModeContext');
const CapabilityRegistry = require('../../../src/core/registry/CapabilityRegistry');
const EventBus = require('../../../src/core/EventBus');
const Operation = require('../../../src/operations/Operation');

class FakeMode extends ManagedMode {
    constructor(options, { fail = false, errorCode = null, order = [] } = {}) {
        super(options);
        this.fail = fail;
        this.errorCode = errorCode;
        this.order = order;
    }

    async onEnable() {
        this.subscriptions.add(() => this.order.push('first'));
        this.subscriptions.add(() => this.order.push('second'));
        if (this.fail) {
            const error = new Error('enable-fail');
            if (this.errorCode) error.code = this.errorCode;
            throw error;
        }
    }

    async onPause() { this.order.push('pause'); }
    async onResume() { this.order.push('resume'); }
    async onDisable() { this.order.push('disable'); }
}

async function harness({ readyRef = { value: true }, generationRef = { value: 1 }, fail = false, errorCode = null } = {}) {
    const catalog = new ModeCatalog([{ id: 'fake', serviceName: 'fakeMode', label: 'Fake', requiredCapabilities: ['movement'] }]).seal();
    const capabilities = new CapabilityRegistry({ botId: 'bot-01' })
        .register('movement', {}, { readiness: () => ({ ready: readyRef.value, reason: 'not-ready' }) })
        .seal();
    const modeContext = new ModeContext({
        botId: 'bot-01',
        botContext: { has: () => true, getGeneration: () => generationRef.value },
        capabilityRegistry: capabilities,
        eventBus: new EventBus(),
        operationManager: { run() {} }
    });
    const coordinator = new ModeCoordinator({ botId: 'bot-01' });
    await coordinator.initialize();
    await coordinator.start();
    const order = [];
    return {
        mode: new FakeMode(
            { modeId: 'fake', botId: 'bot-01', modeContext, modeCoordinator: coordinator, catalog },
            { fail, errorCode, order }
        ),
        coordinator,
        order
    };
}

test('WP-201 partial enable failure closes acquired cleanup in reverse order and releases exact lease', async () => {
    const { mode, coordinator, order } = await harness({ fail: true });
    const result = await mode.enable();
    assert.equal(result.success, false);
    assert.deepEqual(order, ['second', 'first']);
    assert.equal(coordinator.owner(), null);
    assert.equal(mode.status().phase, 'OFF');
});

test('WP-201 pause/resume rechecks readiness and captures new generation; disable/destroy are idempotent', async () => {
    const readyRef = { value: true };
    const generationRef = { value: 3 };
    const { mode, coordinator } = await harness({ readyRef, generationRef });
    assert.equal((await mode.enable()).success, true);
    assert.equal(mode.status().activeGeneration, 3);
    assert.equal((await mode.pause()).success, true);
    readyRef.value = false;
    generationRef.value = 4;
    const blocked = await mode.resume();
    assert.equal(blocked.success, false);
    assert.equal(mode.status().paused, true);
    readyRef.value = true;
    assert.equal((await mode.resume()).success, true);
    assert.equal(mode.status().activeGeneration, 4);
    assert.equal((await mode.disable()).success, true);
    assert.equal((await mode.disable()).success, true);
    assert.equal((await mode.destroy()).success, true);
    assert.equal(coordinator.owner(), null);
});

test('ManagedMode lifecycle failures preserve the shared operation status classification', async () => {
    for (const code of ['COMMAND_STALE_GENERATION', 'GUI_WAIT_DISCONNECTED', 'TIMEOUT', 'OPERATION_LOCK_BUSY']) {
        const { mode, coordinator } = await harness({ fail: true, errorCode: code });
        const result = await mode.enable();
        assert.equal(result.success, false);
        assert.equal(result.error?.code, code);
        assert.equal(result.status, Operation.statusForError({ code }), `${code} must preserve operation status semantics`);
        assert.equal(coordinator.owner(), null);
    }
});
