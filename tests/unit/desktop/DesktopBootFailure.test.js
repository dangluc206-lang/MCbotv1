'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const DesktopController = require('../../../src/desktop/DesktopController');

test('XP-015 controller retains structured boot failure until a successful retry', async () => {
    let attempt = 0;
    const application = { initialize: async () => {}, start: async () => {}, stop: async () => {}, destroy: async () => {}, listRuntimes: () => [], getState: () => 'RUNNING' };
    const controller = new DesktopController({
        applicationFactory: async () => {
            attempt += 1;
            if (attempt === 1) throw Object.assign(new Error('schema rejected token=private'), { code: 'CONFIG_SCHEMA_INVALID', path: 'config/app.json' });
            return { application, fleetControl: { profileSnapshot: () => ({}), status: () => null } };
        }
    });
    await assert.rejects(controller.start(), /schema rejected/);
    assert.equal(controller.snapshot().lifecycle, 'FAILED');
    assert.equal(controller.snapshot().bootFailure.stage, 'SCHEMA');
    assert.doesNotMatch(JSON.stringify(controller.snapshot().bootFailure), /private/);
    await controller.start();
    assert.equal(controller.snapshot().lifecycle, 'RUNNING');
    assert.equal(controller.snapshot().bootFailure, null);
    await controller.stop('test');
});
