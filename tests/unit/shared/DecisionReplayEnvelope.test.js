'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const DecisionReplayEnvelope=require('../../../src/shared/contracts/DecisionReplayEnvelope');
const B5ExecutionPlanner=require('../../../src/planning/crafting/B5ExecutionPlanner');
const B5PlannerReplay=require('../../../src/simulation/b5/B5PlannerReplay');

function create(input, overrides={}) { return DecisionReplayEnvelope.create({ domain:'demo', input, decision:{kind:'WAIT',resource:null}, profile:{id:'minerua',revision:'p1'}, policy:{id:'policy',revision:'r1'}, ...overrides }); }

test('WP-300 canonical digest ignores property order and freezes output without mutating input',()=>{
 const a={b:2,a:{y:2,x:1}}; const before=JSON.stringify(a); const one=create(a); const two=create({a:{x:1,y:2},b:2});
 assert.equal(one.digest,two.digest); assert.equal(JSON.stringify(a),before); assert.equal(Object.isFrozen(one),true); assert.equal(Object.isFrozen(one.input.a),true);
});

test('WP-300 profile/policy revision participates in digest while result/metadata do not alter decision identity',()=>{
 const base=create({n:1});
 assert.notEqual(base.digest,create({n:1},{profile:{id:'minerua',revision:'p2'}}).digest);
 assert.notEqual(base.digest,create({n:1},{policy:{id:'policy',revision:'r2'}}).digest);
 assert.equal(base.digest,create({n:1},{result:{outcome:'SUCCESS'},metadata:{traceId:'x'}}).digest);
});

test('WP-300 redacts sensitive fields, rejects runtime objects and rejects explicit version mismatch',()=>{
 const value=create({nested:{password:'hunter2',token:'abc',safe:'ok'}});
 assert.equal(value.input.nested.password,'[REDACTED]'); assert.equal(value.input.nested.token,'[REDACTED]'); assert.equal(value.input.nested.safe,'ok');
 assert.throws(()=>create({when:new Date()}),/unsupported runtime value/);
 assert.throws(()=>DecisionReplayEnvelope.read({...value,version:99}),e=>e.code==='REPLAY_VERSION_UNSUPPORTED');
});

test('WP-300 legacy B5 fixture round-trips through generic envelope and current replay reader',()=>{
 const fixture=require('../../fixtures/replay/b5-planner-basic.json');
 const envelope=DecisionReplayEnvelope.fromLegacyB5Fixture(fixture,{profile:{id:'minerua',revision:'profile-1'}});
 const result=new B5PlannerReplay({planner:new B5ExecutionPlanner()}).replay(envelope);
 assert.equal(result.success,true,result.mismatches.join('; '));
});
