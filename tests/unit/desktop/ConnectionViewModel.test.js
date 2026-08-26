'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { controlState } = require('../../../src/desktop/renderer/features/connection/ConnectionViewModel');

const cases = [
    ['offline terminal', false, 'DISCONNECTED', 'DISCONNECTED', true, false],
    ['connecting', false, 'CONNECTING', 'CONNECTED', false, true],
    ['logged in', true, 'LOGGED_IN', 'CONNECTED', false, true],
    ['authenticating', true, 'AUTHENTICATING', 'CONNECTED', false, true],
    ['connected', true, 'CONNECTED', 'CONNECTED', false, true],
    ['reconnecting', false, 'RECONNECTING', 'CONNECTED', false, true],
    ['kicked with reconnect intent', false, 'KICKED', 'CONNECTED', false, true],
    ['failed terminal', false, 'FAILED', 'DISCONNECTED', true, false]
];

for (const [name, online, phase, desiredConnection, canConnect, canDisconnect] of cases) {
    test(`connection controls: ${name}`, () => {
        const result = controlState({
            connectionOnline: online,
            state: { connectionState: phase },
            intent: { desiredConnection }
        });
        assert.deepEqual(result, {
            phase, online,
            connecting: phase === 'CONNECTING' || phase === 'RECONNECTING',
            wantsConnected: desiredConnection === 'CONNECTED',
            canConnect, canDisconnect
        });
    });
}
