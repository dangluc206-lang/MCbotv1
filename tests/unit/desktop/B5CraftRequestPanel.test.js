'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Panel = require('../../../src/desktop/renderer/features/b5/B5CraftRequestPanel');

const esc = value => String(value ?? '');
const ITEMS = [
    { id: 'titanium', displayName: 'Titanium' },
    { id: 'carbon', displayName: 'Carbon' },
    { id: 'super_alloy', displayName: 'Siêu hợp kim' }
];

function fakePanel({ itemId = 'titanium', quantity = '', all = false } = {}) {
    const nodes = {
        '[data-b5-request-item]': { value: itemId },
        '[data-b5-request-quantity]': { value: quantity },
        '[data-b5-request-all]': { checked: all }
    };
    const panel = { querySelector: selector => nodes[selector] || null };
    panel.closest = selector => (selector === '[data-b5-request-bot]' ? panel : null);
    return panel;
}

test('craftables keeps registry ids and display names and drops malformed entries', () => {
    const items = Panel.craftables([...ITEMS, { id: 'x' }, { displayName: 'y' }, null]);
    assert.deepEqual(items.map(entry => entry.id), ['titanium', 'carbon', 'super_alloy']);
    assert.deepEqual(items.map(entry => entry.displayName), ['Titanium', 'Carbon', 'Siêu hợp kim']);
});

test('render offers real display names as labels and item ids as values', () => {
    const html = Panel.render({ botId: 'bot-01', items: ITEMS, request: null, phase: '', esc });
    assert.match(html, /<option value="titanium">Titanium<\/option>/);
    assert.match(html, /<option value="carbon">Carbon<\/option>/);
    assert.match(html, /<option value="super_alloy">Siêu hợp kim<\/option>/);
    assert.doesNotMatch(html, />B[1-5]</, 'tier letters must never be operator-facing labels');
});

test('render disables start without items and disables clear without a request', () => {
    const empty = Panel.render({ botId: 'bot-01', items: [], request: null, phase: '', esc });
    assert.match(empty, /data-action="b5-request-start" data-bot="bot-01" disabled/);
    assert.match(empty, /data-action="b5-request-clear" data-bot="bot-01" disabled/);
    const active = Panel.render({ botId: 'bot-01', items: ITEMS, request: { targetItemId: 'titanium', state: 'RUNNING' }, phase: 'CRAFTING', esc });
    assert.doesNotMatch(active, /b5-request-clear" data-bot="bot-01" disabled/);
});

test('render shows the current request status inside the panel', () => {
    const html = Panel.render({
        botId: 'bot-01', items: ITEMS, esc,
        request: { targetItemId: 'carbon', targetDisplayName: 'Carbon', state: 'RUNNING', quantityMode: 'FIXED', quantity: 100, completedUnits: 25, remaining: 75 },
        phase: 'CRAFTING'
    });
    assert.match(html, /Carbon/);
    assert.match(html, /còn 75/);
    assert.match(html, /đã xong 25/);
});

test('readForm sends a chosen item with a positive integer quantity', () => {
    assert.deepEqual(Panel.readForm(fakePanel({ itemId: 'titanium', quantity: '10' })), { targetItemId: 'titanium', quantity: 10 });
    assert.deepEqual(Panel.readForm(fakePanel({ itemId: 'carbon', quantity: '100' })), { targetItemId: 'carbon', quantity: 100 });
    assert.deepEqual(Panel.readForm(fakePanel({ itemId: 'super_alloy', quantity: '1' })), { targetItemId: 'super_alloy', quantity: 1 });
});

test('readForm sends ALL as a mode when the checkbox is used', () => {
    assert.deepEqual(Panel.readForm(fakePanel({ itemId: 'titanium', quantity: '', all: true })), { targetItemId: 'titanium', quantity: 'ALL' });
    assert.deepEqual(Panel.readForm(fakePanel({ itemId: 'titanium', quantity: '10', all: true })), { targetItemId: 'titanium', quantity: 'ALL' });
});

test('readForm rejects empty, zero, negative and fractional quantities at the UI boundary', () => {
    for (const quantity of ['', '   ', '0', '-1', '1.5', 'abc']) {
        assert.throws(() => Panel.readForm(fakePanel({ itemId: 'titanium', quantity })), /Số lượng phải là số nguyên dương|Hãy nhập số lượng/);
    }
    assert.throws(() => Panel.readForm(fakePanel({ itemId: '', quantity: '10' })), /Hãy chọn vật phẩm/);
});

test('statusText reports FIXED remaining, ALL mode, state labels and stop reason', () => {
    assert.equal(Panel.statusText(null, '').line, 'Không có yêu cầu chế tạo');

    const fixed = Panel.statusText({ targetItemId: 'titanium', targetDisplayName: 'Titanium', state: 'RUNNING', quantityMode: 'FIXED', remaining: 7, completedUnits: 3 }, 'CRAFTING');
    assert.equal(fixed.line, 'Titanium');
    assert.match(fixed.detail, /Đang chế/);
    assert.match(fixed.detail, /còn 7/);

    const all = Panel.statusText({ targetItemId: 'titanium', state: 'RUNNING', quantityMode: 'ALL', completedUnits: 12 }, 'CRAFTING');
    assert.match(all.detail, /ALL/);
    assert.doesNotMatch(all.detail, /Infinity/);
});

test('statusText covers every terminal state and never resumes another target', () => {
    const labels = { COMPLETED: 'Hoàn thành', EXHAUSTED: 'Dừng: hết khả thi', BLOCKED: 'Bị chặn', FAILED: 'Thất bại' };
    for (const [state, label] of Object.entries(labels)) {
        const status = Panel.statusText({ targetItemId: 'super_alloy', targetDisplayName: 'Siêu hợp kim', state, quantityMode: 'FIXED', remaining: 3, completedUnits: 7, lastError: 'blocked-without-progress' }, 'WAITING_REQUEST');
        assert.equal(status.line, 'Siêu hợp kim');
        assert.match(status.detail, new RegExp(label));
        assert.match(status.detail, /lý do: blocked-without-progress/);
    }
});

test('statusText reflects WAITING_REQUEST idle phase for the operator', () => {
    const status = Panel.statusText({ targetItemId: 'titanium', targetDisplayName: 'Titanium', state: 'COMPLETED', quantityMode: 'FIXED', remaining: 0, completedUnits: 1 }, 'WAITING_REQUEST');
    assert.match(status.detail, /Chờ yêu cầu mới của operator/);
});