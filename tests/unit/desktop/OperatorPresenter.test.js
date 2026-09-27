'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const MODULE_PATH = 'src/desktop/renderer/features/operator/OperatorPresenter.js';
const presenter = require(path.join(ROOT, MODULE_PATH));

// The presenter was extracted out of app.js, which aliases it as
// `const { viPhase, ... } = window.MCbotOperatorPresenter`. The alias only works
// when index.html loads the module before the app entry point.
test('operator presenter is loaded before the renderer entry point', () => {
    const html = fs.readFileSync(path.join(ROOT, 'src/desktop/renderer/index.html'), 'utf8');
    assert.match(html, /<script src="features\/operator\/OperatorPresenter\.js"><\/script>/);
    assert.ok(
        html.indexOf('features/operator/OperatorPresenter.js') < html.indexOf('src="app.js"'),
        'OperatorPresenter must be loaded before app.js'
    );
    assert.match(
        fs.readFileSync(path.join(ROOT, 'src/desktop/renderer/app.js'), 'utf8'),
        /=\s*window\.MCbotOperatorPresenter;/,
        'app.js must alias the presenter instead of re-declaring the helpers'
    );
});

test('operator presenter exports every helper app.js aliases', () => {
    assert.deepEqual(
        Object.keys(presenter).sort(),
        ['activeOperation', 'connClass', 'formatDuration', 'position', 'viConnection', 'viModeBadge', 'viPhase', 'viPressure', 'viWaitingReason']
    );
});

test('formatDuration switches unit at the minute and hour boundaries', () => {
    assert.equal(presenter.formatDuration(0), '0s');
    assert.equal(presenter.formatDuration(65_000), '1m 5s');
    assert.equal(presenter.formatDuration(3_600_000), '1h 0m');
    assert.equal(presenter.formatDuration(null), '0s');
});

test('viPhase maps known phases and degrades readably for unknown ones', () => {
    assert.equal(presenter.viPhase('WAITING_HEADROOM'), 'Chờ chỗ trống để bung khối');
    assert.equal(presenter.viPhase('CRAFTING'), 'Đang chế tạo');
    assert.equal(presenter.viPhase('SOME_FUTURE_PHASE'), 'SOME FUTURE PHASE', 'unknown phases keep the raw value with underscores spaced');
    assert.equal(presenter.viPhase(''), '—');
});

test('label maps fall back to the raw value instead of undefined', () => {
    assert.equal(presenter.viConnection('connected'), 'Đã kết nối');
    assert.equal(presenter.viConnection('SOMETHING_NEW'), 'SOMETHING_NEW');
    assert.equal(presenter.viConnection(''), 'Không rõ');
    assert.equal(presenter.viPressure('NORMAL'), 'Bình thường');
    assert.equal(presenter.viModeBadge('running'), 'ĐANG CHẠY');
    assert.equal(presenter.viModeBadge(''), 'ĐANG RẢNH');
    assert.equal(presenter.viWaitingReason('storage-pressure'), 'giảm áp lực kho');
    assert.equal(presenter.viWaitingReason('unknown-reason'), 'unknown-reason');
});

test('connClass only reports classes the stylesheet defines', () => {
    for (const value of ['connected', 'reconnecting', 'disconnected', 'failed']) assert.equal(presenter.connClass(value.toUpperCase()), value);
    assert.equal(presenter.connClass('RUNNING'), '');
    assert.equal(presenter.connClass(null), '');
});

test('position and activeOperation degrade when the runtime projection is missing', () => {
    assert.equal(presenter.position({ position: { x: 1.24, y: 64, z: -3.06 } }), '1.2, 64.0, -3.1');
    assert.equal(presenter.position({}), '—');
    assert.equal(presenter.position(null), '—');

    assert.equal(presenter.activeOperation({}), null);
    assert.deepEqual(
        presenter.activeOperation({ operation: { active: 2, operations: [{ operationName: 'Chế tạo', metadata: { step: 'B2' } }] } }),
        { name: 'Chế tạo', detail: 'B2', active: 2 }
    );
    assert.deepEqual(
        presenter.activeOperation({ operation: { operations: [{ operationId: 'op-1', status: 'RUNNING' }] } }),
        { name: 'op-1', detail: 'RUNNING', active: 1 }
    );
});
