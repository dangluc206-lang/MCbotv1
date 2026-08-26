'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const RuntimeEnvironment = require('../../../src/bootstrap/RuntimeEnvironment');

test('RuntimeEnvironment loads dotenv into an isolated copy without overriding process values', () => {
    const base = { KEEP: 'process-value' };
    let received = null;
    const result = RuntimeEnvironment.resolveRuntimeEnvironment({
        baseDir: 'C:/project',
        baseEnvironment: base,
        dotenvConfig(options) {
            received = options;
            if (!options.processEnv.KEEP) options.processEnv.KEEP = 'dotenv-value';
            options.processEnv.FROM_DOTENV = 'loaded';
            return { parsed: { KEEP: 'dotenv-value', FROM_DOTENV: 'loaded' } };
        }
    });

    assert.deepEqual(base, { KEEP: 'process-value' });
    assert.equal(result.environment.KEEP, 'process-value');
    assert.equal(result.environment.FROM_DOTENV, 'loaded');
    assert.equal(received.override, false);
    assert.equal(received.quiet, true);
    assert.equal(received.path, path.join(path.resolve('C:/project'), '.env'));
    assert.equal(result.provenance.dotenvState, 'LOADED');
    assert.equal(Object.isFrozen(result.environment), true);
});

test('RuntimeEnvironment treats a missing dotenv file as an optional source', () => {
    const result = RuntimeEnvironment.resolveRuntimeEnvironment({
        baseEnvironment: { SAFE: '1' },
        dotenvConfig() { return { error: Object.assign(new Error('missing'), { code: 'ENOENT' }) }; }
    });
    assert.deepEqual(result.environment, { SAFE: '1' });
    assert.equal(result.provenance.dotenvState, 'MISSING');
});

test('RuntimeEnvironment fails closed for non-missing dotenv errors', () => {
    assert.throws(() => RuntimeEnvironment.resolveRuntimeEnvironment({
        baseEnvironment: {},
        dotenvConfig() { throw Object.assign(new Error('denied'), { code: 'EACCES' }); }
    }), error => error.code === 'ENVIRONMENT_LOAD_FAILED' && error.cause.code === 'EACCES');
});

test('RuntimeEnvironment rejects invalid base environment shapes', () => {
    assert.throws(() => RuntimeEnvironment.resolveRuntimeEnvironment({ baseEnvironment: [], loadDotenv: false }), /must be an object/);
    assert.throws(() => RuntimeEnvironment.resolveRuntimeEnvironment({ baseEnvironment: null, loadDotenv: false }), /must be an object/);
});
