'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const SprintJumpRouteExecutor = require('../../../src/movement/navigation/SprintJumpRouteExecutor');

test('SprintJumpRouteExecutor keeps cleanup best-effort but reports every failed control release', async () => {
    const bot = new EventEmitter();
    bot.setControlState = () => {};
    bot.lookAt = () => Promise.resolve();
    bot.blockAt = () => null;
    bot.entity = { velocity: { x: 0, y: 0, z: 0 } };
    const position = { x: 1, y: 64, z: 1 };
    const warnings = [];
    const executor = new SprintJumpRouteExecutor({
        context: { require: () => bot, get: () => bot, has: () => true },
        controlStateManager: {
            set(control, value) {
                if (value === false) throw Object.assign(new Error(`release ${control} failed`), { code: 'CONTROL_RELEASE_FAIL' });
            },
            clear() { throw Object.assign(new Error('clear failed'), { code: 'CONTROL_CLEAR_FAIL' }); }
        },
        rotationService: { lookAt: () => Promise.resolve() },
        positionService: {
            current: () => position,
            distance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
        },
        logger: { warn: (message, meta) => warnings.push({ message, meta }), info() {}, debug() {} }
    });
    const result = await executor.goTo(position, { timeoutMs: 500, targetReachDistance: 0.1 });
    assert.deepEqual(result.position, position);
    assert.equal(warnings.filter(entry => /control release failed/i.test(entry.message)).length, 6);
    assert.equal(warnings.filter(entry => /manager clear failed/i.test(entry.message)).length, 1);
});
