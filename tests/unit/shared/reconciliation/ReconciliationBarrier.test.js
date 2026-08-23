'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ReconciliationBarrier=require('../../../../src/shared/reconciliation/ReconciliationBarrier');
const O=ReconciliationBarrier.Outcome;

test('WP-301 applied-but-response-lost resolves without authorizing duplicate mutation', async()=>{
 let reads=0, mutations=0;
 const barrier=new ReconciliationBarrier({maxFreshReads:3});
 const result=await barrier.reconcile({expectedGeneration:4,getGeneration:()=>4,resourceKeys:['storage'],observeFresh:async()=>({outputDelta:++reads>=2?1:0}),classify:e=>e.outputDelta>=1?O.APPLIED:O.UNRESOLVED});
 assert.equal(result.outcome,O.APPLIED); assert.equal(result.blocksMutation,true); assert.equal(result.mayReplan,false); assert.equal(result.attempts,2); assert.equal(mutations,0);
});

test('WP-301 proven no-effect is the only outcome that authorizes re-plan', async()=>{
 const barrier=new ReconciliationBarrier({maxFreshReads:2});
 let reads=0;
 const result=await barrier.reconcile({observeFresh:async()=>({unchanged:++reads>=2}),classify:e=>e.unchanged?O.NOT_APPLIED:O.UNRESOLVED});
 assert.equal(result.outcome,O.NOT_APPLIED); assert.equal(result.mayReplan,true); assert.equal(result.blocksMutation,false);
});

test('WP-301 unresolved evidence stays bounded and resource lease is released', async()=>{
 const calls=[]; const barrier=new ReconciliationBarrier({maxFreshReads:2});
 const result=await barrier.reconcile({resourceKeys:['gui','storage'],owner:'x',acquire:async(keys)=>{calls.push(['acquire',keys]);return {id:1};},release:async()=>calls.push(['release']),observeFresh:async()=>({complete:false}),classify:()=>O.UNRESOLVED});
 assert.equal(result.outcome,O.UNRESOLVED); assert.equal(result.attempts,2); assert.deepEqual(calls,[['acquire',['gui','storage']],['release']]);
});

test('WP-301 stale generation and cancellation fail closed before extra reads', async()=>{
 const barrier=new ReconciliationBarrier(); let reads=0;
 const stale=await barrier.reconcile({expectedGeneration:7,getGeneration:()=>8,observeFresh:async()=>{reads++;return{};},classify:()=>O.NOT_APPLIED});
 assert.equal(stale.outcome,O.STALE); assert.equal(reads,0);
 const cancelled=await barrier.reconcile({cancellationToken:{isCancelled:true,throwIfCancelled(){}},observeFresh:async()=>{reads++;return{};},classify:()=>O.NOT_APPLIED});
 assert.equal(cancelled.outcome,O.CANCELLED); assert.equal(reads,0);
});

test('WP-301 resource contention blocks reconciliation and never observes', async()=>{
 const barrier=new ReconciliationBarrier(); let reads=0;
 const result=await barrier.reconcile({resourceKeys:['storage'],acquire:async()=>null,observeFresh:async()=>{reads++;return{};},classify:()=>O.NOT_APPLIED});
 assert.equal(result.outcome,O.RESOURCE_BUSY); assert.equal(reads,0); assert.equal(result.blocksMutation,true);
});
