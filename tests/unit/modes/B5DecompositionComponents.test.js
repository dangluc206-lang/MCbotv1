'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const CraftCampaignSession = require('../../../src/modes/crafting/campaign/CraftCampaignSession');
const CraftBatchCoordinator = require('../../../src/modes/crafting/campaign/CraftBatchCoordinator');
const StorageProtectionEpisode = require('../../../src/modes/crafting/storage/StorageProtectionEpisode');
const CraftFaultPolicyAdapter = require('../../../src/modes/crafting/fault/CraftFaultPolicyAdapter');
const CraftingStatusProjection = require('../../../src/modes/crafting/status/CraftingStatusProjection');

test('campaign and batch identity are bot scoped, monotonic and generation explicit', () => {
    const session = new CraftCampaignSession({ botId: 'bot-01', clock: () => 1_000 });
    assert.deepEqual(session.open({ generation: 7 }), {
        campaignId: 'bot-01:craft-campaign:1', botId: 'bot-01', generation: 7,
        trigger: 'enable', openedAt: '1970-01-01T00:00:01.000Z'
    });
    const batches = new CraftBatchCoordinator({ botId: 'bot-01' });
    assert.equal(batches.next('enable').batchId, 'bot-01:craft-batch:1');
    assert.equal(batches.next('post-target-complete').batchId, 'bot-01:craft-batch:2');
});

test('storage protection episode starts immutable in meaning with bounded counters at zero', () => {
    const episode = StorageProtectionEpisode.create({ batchId: 'bot-01:craft-batch:4', trigger: 'next', evidenceKey: 'e1' });
    assert.equal(episode.episodeId, 'bot-01:craft-batch:4:storage-protection');
    assert.equal(episode.state, 'PENDING');
    assert.equal(episode.businessFailureAttempts, 0);
    assert.equal(episode.continuationSlices, 0);
});

test('fault adapter preserves the existing policy contract without exposing implementation ownership', () => {
    const calls = [];
    const policy = Object.fromEntries(['reset','close','beforeAttempt','record','recordBlocker','resolveEpisode','restartPolicy','snapshot'].map(name => [name, (...args) => { calls.push([name, ...args]); return name; }]));
    const adapter = new CraftFaultPolicyAdapter(policy);
    assert.equal(adapter.recordBlocker('x'), 'recordBlocker');
    assert.deepEqual(calls, [['recordBlocker', 'x']]);
});

test('status projection copies mutable collections and keeps campaign boundary visible', () => {
    const blockers = [{ code: 'TIMEOUT' }];
    const status = CraftingStatusProjection.create({ campaign: { campaignId: 'c1' }, lastAutomationBlockers: blockers, policy: { smelting: true } });
    blockers.push({ code: 'OTHER' });
    assert.equal(status.lastAutomationBlockers.length, 1);
    assert.equal(status.campaign.campaignId, 'c1');
    assert.equal(status.policy.smelting, true);
});
