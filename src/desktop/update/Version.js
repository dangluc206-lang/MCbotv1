'use strict';

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(value) {
    const text = String(value || '').trim();
    const match = VERSION_RE.exec(text);
    if (!match) return null;
    return Object.freeze({
        raw: text,
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
        prerelease: match[4] ? match[4].split('.').filter(Boolean) : []
    });
}

function compareIdentifiers(left, right) {
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) return Number(left) - Number(right);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left.localeCompare(right);
}

function compareVersions(leftValue, rightValue) {
    const left = typeof leftValue === 'object' ? leftValue : parseVersion(leftValue);
    const right = typeof rightValue === 'object' ? rightValue : parseVersion(rightValue);
    if (!left || !right) throw new TypeError(`Phiên bản không hợp lệ: ${leftValue} / ${rightValue}`);
    for (const key of ['major', 'minor', 'patch']) {
        if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
    }
    if (!left.prerelease.length && !right.prerelease.length) return 0;
    if (!left.prerelease.length) return 1;
    if (!right.prerelease.length) return -1;
    const length = Math.max(left.prerelease.length, right.prerelease.length);
    for (let index = 0; index < length; index += 1) {
        if (left.prerelease[index] === undefined) return -1;
        if (right.prerelease[index] === undefined) return 1;
        const compared = compareIdentifiers(left.prerelease[index], right.prerelease[index]);
        if (compared !== 0) return compared > 0 ? 1 : -1;
    }
    return 0;
}

function normalizeVersion(value) {
    const parsed = parseVersion(value);
    if (!parsed) return null;
    return `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.prerelease.length ? `-${parsed.prerelease.join('.')}` : ''}`;
}

module.exports = { parseVersion, compareVersions, normalizeVersion };
