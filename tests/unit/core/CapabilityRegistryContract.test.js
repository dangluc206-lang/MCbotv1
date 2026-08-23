'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const CapabilityRegistry=require('../../../src/core/registry/CapabilityRegistry');

test('WP-200 registry detects duplicate, missing and incompatible dependency at seal',()=>{
 const duplicate=new CapabilityRegistry().register('commands',{}, {version:'1.2.0'});assert.throws(()=>duplicate.register('commands',{}),/already registered/);
 const missing=new CapabilityRegistry().register('storage',{}, {dependencies:['commands']});assert.throws(()=>missing.seal(),e=>e.code==='CAPABILITY_DEPENDENCY_MISSING');
 const incompatible=new CapabilityRegistry().register('commands',{}, {version:'2.0.0'}).register('storage',{}, {dependencies:[{id:'commands',version:'1.x'}]});assert.throws(()=>incompatible.seal(),e=>e.code==='CAPABILITY_DEPENDENCY_VERSION_MISMATCH');
});

test('WP-200 version/readiness/introspection are additive and immutable',()=>{
 let ready=false;const provider={send(){}};const registry=new CapabilityRegistry({botId:'bot-01'}).register('commands',provider,{version:'1.3.2',scope:'connection',readiness:()=>({ready,reason:ready?null:'disconnected'}),resultContract:'operation-result-v1'}).seal();
 assert.equal(registry.require('commands'),provider);assert.equal(registry.require('commands',{version:'1.x'}),provider);assert.throws(()=>registry.require('commands',{version:'2.x'}),e=>e.code==='CAPABILITY_VERSION_MISMATCH');assert.equal(registry.readiness('commands').ready,false);assert.throws(()=>registry.require('commands',{ready:true}),e=>e.code==='CAPABILITY_NOT_READY');
 ready=true;assert.equal(registry.require('commands',{ready:true}),provider);const snap=registry.snapshot();assert.equal(snap.capabilities[0].version,'1.3.2');assert.equal(snap.capabilities[0].scope,'connection');assert.equal(snap.capabilities[0].resultContract,'operation-result-v1');assert.equal(Object.isFrozen(snap),true);
});

test('WP-200 bot-scoped registries do not leak providers/readiness',()=>{
 const a=new CapabilityRegistry({botId:'a'}).register('movement',{bot:'a'}).seal();const b=new CapabilityRegistry({botId:'b'}).register('movement',{bot:'b'}).seal();assert.equal(a.require('movement').bot,'a');assert.equal(b.require('movement').bot,'b');assert.equal(a.snapshot().botId,'a');assert.equal(b.snapshot().botId,'b');
});
