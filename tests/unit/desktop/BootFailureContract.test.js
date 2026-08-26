'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const BootFailureContract = require('../../../src/desktop/BootFailureContract');

test('XP-015 maps JSON/schema/migration failures to sanitized boot stages', () => {
    const baseDir = path.resolve('C:/safe-project');
    const malformed = Object.assign(new SyntaxError('Unexpected token in JSON token=secret-value'), { path: path.join(baseDir, 'config', 'app.json') });
    const value = BootFailureContract.create(malformed, { baseDir });
    assert.equal(value.stage, 'CONFIG_PARSE');
    assert.equal(value.configPath, 'config/app.json');
    assert.doesNotMatch(JSON.stringify(value), /secret-value/);
    assert.equal(BootFailureContract.inferStage({ code: 'CONFIG_SCHEMA_INVALID' }), 'SCHEMA');
    assert.equal(BootFailureContract.inferStage({ code: 'CONFIG_MIGRATION_FAILED' }), 'MIGRATION');
});

test('XP-015 external paths are reduced to basename', () => {
    const value = BootFailureContract.create(Object.assign(new Error('bad config'), { code: 'CONFIG_INVALID', path: 'D:/external/private/config.json' }), { baseDir: 'C:/safe-project' });
    assert.equal(value.configPath, 'config.json');
});
