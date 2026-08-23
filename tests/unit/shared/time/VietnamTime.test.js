'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const VietnamTime = require('../../../../src/shared/time/VietnamTime');
const Logger = require('../../../../src/shared/logger/Logger');

test('VietnamTime renders UTC instants as ISO +07:00 and rolls the local date correctly', () => {
    const instant = Date.UTC(2026, 7, 20, 17, 0, 0, 123);
    assert.equal(VietnamTime.iso(instant), '2026-08-21T00:00:00.123+07:00');
    assert.equal(VietnamTime.dateKey(instant), '2026-08-21');
});

test('Logger top-level timestamps are Vietnam time', () => {
    let record = null;
    const logger = new Logger({ scope: 'test', output: value => { record = value; } });
    logger.info('hello');
    assert.match(record.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+07:00$/);
});
