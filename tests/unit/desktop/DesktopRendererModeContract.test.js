'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.resolve(__dirname, '../../../src/desktop/renderer/app.js'), 'utf8');
const apiClient = fs.readFileSync(path.resolve(__dirname, '../../../src/desktop/renderer/core/RendererApiClient.js'), 'utf8');
// botCard moved out of the legacy facade into features/bots/BotCardPresenter.js:
// card markup assertions read that module, app.js keeps only shell assertions.
const botCardPresenter = fs.readFileSync(path.resolve(__dirname, '../../../src/desktop/renderer/features/bots/BotCardPresenter.js'), 'utf8');

test('Desktop renderer allows durable mode start while disconnected and surfaces nested core failures', () => {
    assert.doesNotMatch(renderer, /disabled:\s*!connected\s*\|\|\s*!entry\.readiness/);
    assert.match(botCardPresenter, /Bật mode và tự kết nối bot/);
    assert.match(renderer, /MCbotRendererApiClient\.call/);
    assert.match(apiClient, /data\.success === false/);
    assert.match(renderer, /Đang kết nối để bật chế độ/);
});


test('Desktop renderer exposes bounded B5 protection blocker state and no legacy auto-join/pressure labels', () => {
    assert.match(botCardPresenter, /Gate bảo vệ kho/);
    assert.match(botCardPresenter, /protectionEpisode/);
    assert.match(botCardPresenter, /nextEligibleAt/);
    assert.match(botCardPresenter, /backoffMs/);
    assert.match(botCardPresenter, /Sky gateway/);
    for (const source of [renderer, botCardPresenter]) {
        assert.doesNotMatch(source, /Skyblock tự vào/);
        assert.doesNotMatch(source, /Áp lực kho/);
        assert.doesNotMatch(source, /lastPressureObservation/);
    }
});
