'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ContractFixtureFactory = require('../../fixtures/contracts/ContractFixtureFactory');
const DesktopApiContract = require('../../../src/desktop/contracts/DesktopApiContract');
const ConfigSpecs = require('../../../src/configuration/ConfigSpecs');
const OperatorSnapshotProjector = require('../../../src/desktop/projection/OperatorSnapshotProjector');

test('XP-401 fixtures are derived from actual Desktop/config/module contracts', () => {
    assert.deepEqual(ContractFixtureFactory.desktopChannels(), Object.keys(DesktopApiContract.CATALOG).sort());
    assert.deepEqual(ContractFixtureFactory.configManifest().map(item => item.key), ConfigSpecs.map(item => item.key));
    const modules = ContractFixtureFactory.moduleCatalog();
    assert.equal(modules.length, 17);
    assert.ok(modules.every(module => module.presentation.contract === 'workflow-module-presentation-v1'));
});

test('XP-401 operator fixture passes the real compact projection contract at 64 bots', () => {
    const result = new OperatorSnapshotProjector().project(ContractFixtureFactory.operatorSnapshot(64));
    assert.equal(result.contract, 'operator-snapshot-v1');
    assert.equal(result.fleet.total, 64);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 128 * 1024);
});
