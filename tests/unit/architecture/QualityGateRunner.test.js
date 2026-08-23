'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { STATUS, classifyExit, overallStatus } = require('../../../scripts/run-quality-gates');

test('WP-402 gate status distinguishes PASS, FAIL and environment BLOCKED', () => {
    assert.equal(classifyExit(0, { blockedExitCodes: [2] }), STATUS.PASS);
    assert.equal(classifyExit(1, { blockedExitCodes: [2] }), STATUS.FAIL);
    assert.equal(classifyExit(2, { blockedExitCodes: [2] }), STATUS.BLOCKED);
    assert.equal(classifyExit(2, { blockedExitCodes: [] }), STATUS.FAIL, 'exit 2 is not globally forgiven');
});

test('WP-402 overall quality status never promotes BLOCKED or FAIL to PASS', () => {
    assert.equal(overallStatus([{ status: STATUS.PASS }]), STATUS.PASS);
    assert.equal(overallStatus([{ status: STATUS.PASS }, { status: STATUS.BLOCKED }]), STATUS.BLOCKED);
    assert.equal(overallStatus([{ status: STATUS.BLOCKED }, { status: STATUS.FAIL }]), STATUS.FAIL);
});
