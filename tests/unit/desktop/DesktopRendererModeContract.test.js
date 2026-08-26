'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.resolve(__dirname, '../../../src/desktop/renderer/app.js'), 'utf8');
const apiClient = fs.readFileSync(path.resolve(__dirname, '../../../src/desktop/renderer/core/RendererApiClient.js'), 'utf8');

test('Desktop renderer allows durable mode start while disconnected and surfaces nested core failures', () => {
    assert.doesNotMatch(renderer, /disabled:\s*!connected\s*\|\|\s*!entry\.readiness/);
    assert.match(renderer, /Bật mode và tự kết nối bot/);
    assert.match(renderer, /MCbotRendererApiClient\.call/);
    assert.match(apiClient, /data\.success === false/);
    assert.match(renderer, /Đang kết nối để bật chế độ/);
});


test('Desktop renderer exposes bounded B5 protection blocker state and no legacy auto-join/pressure labels', () => {
    assert.match(renderer, /Gate bảo vệ kho/);
    assert.match(renderer, /protectionEpisode/);
    assert.match(renderer, /nextEligibleAt/);
    assert.match(renderer, /backoffMs/);
    assert.match(renderer, /Sky gateway/);
    assert.doesNotMatch(renderer, /Skyblock tự vào/);
    assert.doesNotMatch(renderer, /Áp lực kho/);
    assert.doesNotMatch(renderer, /lastPressureObservation/);
});
