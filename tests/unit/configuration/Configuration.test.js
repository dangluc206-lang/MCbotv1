'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const ConfigLoader=require('../../../src/configuration/ConfigLoader');const ConfigRegistry=require('../../../src/configuration/ConfigRegistry');const ConfigValidator=require('../../../src/configuration/ConfigValidator');
test('ConfigLoader reads and deep freezes JSON',async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mcbot-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.writeFile(path.join(dir,'a.json'),'[{"nested":{"v":1}}]');const value=await new ConfigLoader({baseDir:dir}).load('a.json');assert.equal(Object.isFrozen(value),true);assert.equal(Object.isFrozen(value[0].nested),true);});
test('ConfigLoader classifies missing and invalid JSON',async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'mcbot-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const loader=new ConfigLoader({baseDir:dir});await assert.rejects(()=>loader.load('missing.json'),e=>e.code==='CONFIG_FILE_NOT_FOUND');await fs.writeFile(path.join(dir,'bad.json'),'{');await assert.rejects(()=>loader.load('bad.json'),e=>e.code==='CONFIG_INVALID_JSON');});
test('ConfigRegistry isolates values and validator contract',()=>{const registry=new ConfigRegistry();const input={a:{b:1}};registry.register('x',input);input.a.b=2;assert.equal(registry.require('x').a.b,1);assert.throws(()=>registry.register('x',{}),/already exists/);const validator=new ConfigValidator({ok:value=>({valid:value===1,errors:value===1?[]:['bad']})});assert.equal(validator.validate('ok',1).valid,true);assert.throws(()=>validator.assertValid('ok',2),/validation failed/i);});

const serverSchema = require('../../../src/configuration/schemas/server.schema');
const appSchema = require('../../../src/configuration/schemas/app.schema');

test('server schema accepts named profiles and rejects missing defaults', () => {
    assert.equal(serverSchema({
        defaultProfile: 'main',
        defaults: { auth: 'offline', version: false },
        profiles: { main: { host: '127.0.0.1', port: 25565 } }
    }).valid, true);

    const invalid = serverSchema({
        defaultProfile: 'missing',
        profiles: { main: { host: '127.0.0.1', port: 25565 } }
    });
    assert.equal(invalid.valid, false);
    assert.equal(invalid.errors.some(error => error.includes('defaultProfile')), true);
});

test('app schema validates operation queue and timeout policy bounds', () => {
    const valid = appSchema({
        operations: {
            maxPending: 8,
            defaultQueueWaitTimeoutMs: 0,
            defaultExecutionTimeoutMs: 100,
            shutdownDrainTimeoutMs: 250
        },
        diagnostics: {
            runtimeFailures: {
                enabled: false,
                directory: 'data/runtime/errors',
                repeatWindowMs: 0,
                connectionAggregationMs: 0,
                maxFileMb: 1,
                maxTotalMb: 1,
                retentionDays: 0,
                cleanupIntervalMs: 0
            },
            circuitBreaker: {
                baseBackoffMs: 0,
                maxBackoffMs: 0,
                multiplier: 1,
                jitterRatio: 0,
                maxConsecutiveFailures: 1,
                openDurationMs: 0
            }
        }
    });
    assert.equal(valid.valid, true, valid.errors.join('; '));

    for (const [key, value] of [
        ['maxPending', 0],
        ['maxPending', 1.5],
        ['defaultQueueWaitTimeoutMs', -1],
        ['defaultExecutionTimeoutMs', -1],
        ['shutdownDrainTimeoutMs', -1]
    ]) {
        const operations = {
            maxPending: 8,
            defaultQueueWaitTimeoutMs: 1,
            defaultExecutionTimeoutMs: 1,
            shutdownDrainTimeoutMs: 1,
            [key]: value
        };
        const result = appSchema({ ...validConfigShell(), operations });
        assert.equal(result.valid, false, `${key}=${value} should be invalid`);
        assert.equal(result.errors.some(error => error.includes(`operations.${key}`)), true);
    }
});

function validConfigShell() {
    return {
        diagnostics: {
            runtimeFailures: {
                enabled: false,
                directory: 'data/runtime/errors',
                repeatWindowMs: 0,
                connectionAggregationMs: 0,
                maxFileMb: 1,
                maxTotalMb: 1,
                retentionDays: 0,
                cleanupIntervalMs: 0
            },
            circuitBreaker: {
                baseBackoffMs: 0,
                maxBackoffMs: 0,
                multiplier: 1,
                jitterRatio: 0,
                maxConsecutiveFailures: 1,
                openDurationMs: 0
            }
        }
    };
}
