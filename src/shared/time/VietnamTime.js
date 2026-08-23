'use strict';

const OFFSET_MINUTES = 7 * 60;
const OFFSET_MS = OFFSET_MINUTES * 60_000;

function parts(value = Date.now()) {
    const date = value instanceof Date ? value : new Date(value);
    const ms = Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
    const shifted = new Date(ms + OFFSET_MS);
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hour: shifted.getUTCHours(),
        minute: shifted.getUTCMinutes(),
        second: shifted.getUTCSeconds(),
        millisecond: shifted.getUTCMilliseconds()
    };
}

function pad(value, width = 2) { return String(value).padStart(width, '0'); }

function iso(value = Date.now()) {
    const p = parts(value);
    return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}.${pad(p.millisecond, 3)}+07:00`;
}

function dateKey(value = Date.now()) {
    const p = parts(value);
    return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

module.exports = Object.freeze({ OFFSET_MINUTES, iso, dateKey, parts });
