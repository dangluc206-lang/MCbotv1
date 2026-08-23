'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const AppError=require('../../../src/shared/errors/AppError');const Result=require('../../../src/shared/result/Result');const Status=require('../../../src/shared/result/Status');const CancellationSource=require('../../../src/shared/cancellation/CancellationSource');const Timeout=require('../../../src/shared/time/Timeout');const LoggerFactory=require('../../../src/shared/logger/LoggerFactory');
test('AppError preserves contract',()=>{const cause=new Error('cause');const error=new AppError('failed',{code:'X',details:{a:1},cause});assert.equal(error.code,'X');assert.equal(error.cause,cause);assert.ok(error instanceof Error);});
test('Result is immutable and does not mutate input',()=>{const input={nested:{value:1}};const result=Result.ok(input);input.nested.value=2;assert.equal(result.data.nested.value,1);assert.equal(result.status,Status.SUCCESS);assert.equal(result.success,true);assert.throws(()=>{Status.SUCCESS='x';},TypeError);});
test('cancellation is idempotent and listeners unsubscribe',()=>{const source=new CancellationSource();let calls=0;const off=source.token.onCancelled(()=>calls++);off();source.cancel('x');source.cancel('y');assert.equal(calls,0);assert.equal(source.token.reason,'x');assert.throws(()=>source.token.throwIfCancelled(),/x/);});
test('Timeout supports delay, completion, timeout and cancellation',async()=>{await Timeout.delay(1);assert.equal(await Timeout.withTimeout(Promise.resolve(3),20),3);await assert.rejects(Timeout.withTimeout(new Promise(()=>{}),5),error=>error.code==='TIMEOUT');const source=new CancellationSource();const pending=Timeout.delay(100,{cancellationToken:source.token});source.cancel('stop');await assert.rejects(pending,error=>error.code==='CANCELLED');});
test('Logger redacts nested secrets and filters levels',()=>{const records=[];const factory=new LoggerFactory({minimumLevel:'info',output:r=>records.push(r)});const logger=factory.create('Test');logger.debug('hidden');logger.info('visible',{password:'x',nested:{token:'y'},safe:1});assert.equal(records.length,1);assert.equal(records[0].meta.password,'[REDACTED]');assert.equal(records[0].meta.nested.token,'[REDACTED]');assert.equal(records[0].meta.safe,1);});


test('cancellation listener failures are isolated, bounded and inspectable', async()=>{
    const source=new CancellationSource({listenerErrorLimit:2});
    let healthy=0;
    source.token.onCancelled(()=>{const e=new Error('listener-one');e.code='LISTENER_ONE';throw e;});
    source.token.onCancelled(()=>{healthy+=1;});
    assert.equal(source.cancel('stop'),true);
    assert.equal(healthy,1);
    assert.equal(source.token.listenerErrors.length,1);
    assert.equal(source.token.listenerErrors[0].code,'LISTENER_ONE');
    assert.equal(source.token.listenerErrors[0].phase,'cancel-listener');
    source.token.onCancelled(()=>{throw new Error('late-listener');});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(source.token.listenerErrors.length,2);
    assert.match(source.token.listenerErrors[1].message,/late-listener/);
    assert.throws(()=>source.token.listenerErrors.push({}),/extensible|read only|object is not extensible/i);
});
