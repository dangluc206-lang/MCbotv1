'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const OperatorSnapshotProjector = require('../../../src/desktop/projection/OperatorSnapshotProjector');
const SnapshotDeliveryCoordinator = require('../../../src/desktop/projection/SnapshotDeliveryCoordinator');

function snapshot(count, updatedAt = '2026-08-25T00:00:00.000Z') {
    return { lifecycle:'RUNNING', updatedAt, system:{ uptimeMs:100, memoryMb:64 }, bots:Array.from({ length:count }, (_, index) => ({ botId:`bot-${index}`, profile:{ displayName:`Bot ${index}`, enabled:true }, connectionOnline:index % 2 === 1, state:{ connectionState:index % 2 ? 'AUTHENTICATING' : 'RECONNECTING' }, connectionGeneration:1, intent:{ desiredConnection:'CONNECTED', desiredMode:index % 3 ? null : 'b5-craft' }, modeOwner:null, modes:{ byId:{}, b5Craft:null }, operation:{ operations:[] } })) };
}

test('OperatorSnapshotProjector emits compact stable revisions and on-demand-safe summaries', () => {
    const projector = new OperatorSnapshotProjector();
    const first = projector.project(snapshot(64));
    const repeated = projector.project(snapshot(64, '2026-08-25T00:00:01.000Z'));
    assert.equal(first.contract, 'operator-snapshot-v1');
    assert.equal(first.revision, repeated.revision, 'updatedAt alone must not churn revision');
    assert.equal(first.digest, repeated.digest);
    assert.equal(first.bots.length, 64);
    assert.equal(first.fleet.connected, 32);
    assert.equal(first.bots[1].online, true);
    assert.equal(first.bots[1].connection, 'AUTHENTICATING');
    assert.equal(first.bots[0].online, false);
    assert.equal(first.bots[0].connection, 'RECONNECTING');
    assert.equal(JSON.stringify(first).includes('inventory'), false);
    assert.equal(Buffer.byteLength(JSON.stringify(first)) < 64000, true);
    const changed = snapshot(64); changed.bots[0].connectionOnline = true;
    assert.equal(projector.project(changed).revision, first.revision + 1);
});

test('SnapshotDeliveryCoordinator coalesces slow-renderer updates and drops duplicates', () => {
    const callbacks = [];
    const delivered = [];
    const coordinator = new SnapshotDeliveryCoordinator({ send:value => delivered.push(value), schedule:callback => callbacks.push(callback) });
    coordinator.offer({ digest:'a', revision:1 });
    coordinator.offer({ digest:'b', revision:2 });
    coordinator.offer({ digest:'c', revision:3 });
    assert.equal(callbacks.length, 1);
    callbacks.shift()();
    assert.deepEqual(delivered.map(item => item.digest), ['c']);
    coordinator.offer({ digest:'c', revision:3 });
    assert.equal(callbacks.length, 0);
    assert.equal(coordinator.status().coalesced, 2);
});
