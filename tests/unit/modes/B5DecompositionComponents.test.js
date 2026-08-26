'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const B5CampaignSession = require('../../../src/modes/b5-craft/campaign/B5CampaignSession');
const B5BatchCoordinator = require('../../../src/modes/b5-craft/campaign/B5BatchCoordinator');
const StorageProtectionEpisode = require('../../../src/modes/b5-craft/storage/StorageProtectionEpisode');
const B5FaultPolicyAdapter = require('../../../src/modes/b5-craft/fault/B5FaultPolicyAdapter');
const B5StatusProjection = require('../../../src/modes/b5-craft/status/B5StatusProjection');

test('campaign and batch identity are bot scoped, monotonic and generation explicit', () => {
    const session = new B5CampaignSession({ botId: 'bot-01', clock: () => 1_000 });
    assert.deepEqual(session.open({ generation: 7 }), {
        campaignId: 'bot-01:b5-campaign:1', botId: 'bot-01', generation: 7,
        trigger: 'enable', openedAt: '1970-01-01T00:00:01.000Z'
    });
    const batches = new B5BatchCoordinator({ botId: 'bot-01' });
    assert.equal(batches.next('enable').batchId, 'bot-01:b5-batch:1');
    assert.equal(batches.next('post-b5-complete').batchId, 'bot-01:b5-batch:2');
});

test('storage protection episode starts immutable in meaning with bounded counters at zero', () => {
    const episode = StorageProtectionEpisode.create({ batchId: 'bot-01:b5-batch:4', trigger: 'next', evidenceKey: 'e1' });
    assert.equal(episode.episodeId, 'bot-01:b5-batch:4:storage-protection');
    assert.equal(episode.state, 'PENDING');
    assert.equal(episode.businessFailureAttempts, 0);
    assert.equal(episode.continuationSlices, 0);
});

test('fault adapter preserves the existing policy contract without exposing implementation ownership', () => {
    const calls = [];
    const policy = Object.fromEntries(['reset','close','beforeAttempt','record','recordBlocker','resolveEpisode','restartPolicy','snapshot'].map(name => [name, (...args) => { calls.push([name, ...args]); return name; }]));
    const adapter = new B5FaultPolicyAdapter(policy);
    assert.equal(adapter.recordBlocker('x'), 'recordBlocker');
    assert.deepEqual(calls, [['recordBlocker', 'x']]);
});

test('status projection copies mutable collections and keeps campaign boundary visible', () => {
    const blockers = [{ code: 'TIMEOUT' }];
    const status = B5StatusProjection.create({ campaign: { campaignId: 'c1' }, lastAutomationBlockers: blockers, policy: { smelting: true } });
    blockers.push({ code: 'OTHER' });
    assert.equal(status.lastAutomationBlockers.length, 1);
    assert.equal(status.campaign.campaignId, 'c1');
    assert.equal(status.policy.smelting, true);
});
