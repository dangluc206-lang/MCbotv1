'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const DailyRecoverySchedule = require('../../../src/shared/time/DailyRecoverySchedule');

function utcForLocal(hour, minute, second = 0) {
    // Config uses UTC+7. 03:00 local == previous-day 20:00 UTC.
    return Date.UTC(2026, 7, 8, hour - 7, minute, second);
}

const config = {
    enabled: true,
    timezoneOffsetMinutes: 420,
    sky: { hour: 3, minute: 0, waitMinutes: 10, retryWindowMinutes: 20 },
    server: { hour: 5, minute: 0, waitMinutes: 10, retryWindowMinutes: 20 }
};

test('03:00 Sky window waits until 03:10 and remains retryable until 03:20', () => {
    const schedule = new DailyRecoverySchedule(config);
    const at0305 = schedule.state('sky', utcForLocal(3, 5));
    assert.equal(at0305.active, true);
    assert.equal(at0305.due, true);
    assert.equal(at0305.waitMs, 5 * 60_000);
    assert.equal(at0305.resumeAt, '03:10');

    const at0312 = schedule.state('sky', utcForLocal(3, 12));
    assert.equal(at0312.active, false);
    assert.equal(at0312.ready, true);
    assert.equal(at0312.due, true);

    const at0321 = schedule.state('sky', utcForLocal(3, 21));
    assert.equal(at0321.due, false);
});

test('05:00 server reconnect is held for the remainder of the 10-minute window', () => {
    const schedule = new DailyRecoverySchedule(config);
    assert.equal(schedule.reconnectDelay(utcForLocal(5, 0)), 10 * 60_000);
    assert.equal(schedule.reconnectDelay(utcForLocal(5, 7, 30)), 150_000);
    assert.equal(schedule.reconnectDelay(utcForLocal(5, 10)), 0);
});

test('schedule is inert when not explicitly enabled', () => {
    const schedule = new DailyRecoverySchedule({});
    assert.equal(schedule.state('sky', utcForLocal(3, 5)).due, false);
    assert.equal(schedule.reconnectDelay(utcForLocal(5, 5)), 0);
});
