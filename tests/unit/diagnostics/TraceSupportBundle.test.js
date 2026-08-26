'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const TraceEnvelope=require('../../../src/diagnostics/runtime/TraceEnvelope');
const SupportBundleBuilder=require('../../../src/diagnostics/support/SupportBundleBuilder');

test('WP-400 trace correlation survives reconnect while generation remains explicit',()=>{const root=TraceEnvelope.create({traceId:'t1',botId:'bot-01',connectionGeneration:7,intentId:'i1',operationId:'o1',decisionDigest:'d1'});const child=TraceEnvelope.create({traceId:'t2',parentTraceId:root.traceId,botId:'bot-01',connectionGeneration:8,intentId:'i1',operationId:'o2',correlationId:root.correlationId,decisionDigest:'d1'});assert.equal(child.parentTraceId,'t1');assert.equal(child.connectionGeneration,8);assert.equal(child.correlationId,root.correlationId);});
test('WP-400 trace and support evidence redact nested secrets and reject schema mismatch',()=>{const t=TraceEnvelope.create({details:{cause:{password:'p',token:'t',message:'Authorization: Bearer xyz'}}});assert.equal(t.details.cause.password,'[REDACTED]');assert.equal(t.details.cause.token,'[REDACTED]');assert.match(t.details.cause.message,/\[REDACTED\]/);assert.throws(()=>TraceEnvelope.read({...t,version:99}),e=>e.code==='TRACE_VERSION_UNSUPPORTED');});
test('WP-400 support bundle is allowlist-only and blocks protected paths/traversal',()=>{const b=new SupportBundleBuilder();const bundle=b.build({entries:[{path:'evidence/trace-a.json',value:{password:'x',safe:1}},{path:'RELEASE_NOTES.txt',content:'token=abc ok'}]});assert.equal(bundle.entryCount,2);assert.match(bundle.files[0].content,/REDACTED/);assert.match(bundle.files[1].content,/REDACTED/);for(const p of ['.env','data/logs/x.json','config/bots/bot-01.json','../secret','node_modules/x'])assert.throws(()=>b.build({entries:[{path:p,value:{}}]}),e=>e.code==='SUPPORT_BUNDLE_PATH_BLOCKED');});
test('WP-400 support bundle enforces per-entry and total size bounds',()=>{const one=new SupportBundleBuilder({maxEntryBytes:256,maxTotalBytes:300});assert.throws(()=>one.build({entries:[{path:'evidence/trace-x.json',content:'x'.repeat(300)}]}),e=>e.code==='SUPPORT_BUNDLE_ENTRY_TOO_LARGE');const two=new SupportBundleBuilder({maxEntryBytes:256,maxTotalBytes:300});assert.throws(()=>two.build({entries:[{path:'evidence/trace-a.json',content:'a'.repeat(180)},{path:'evidence/trace-b.json',content:'b'.repeat(180)}]}),e=>e.code==='SUPPORT_BUNDLE_TOTAL_TOO_LARGE');});

test('XP-011 support bundle v2 hashes content, is deterministic for fixed inputs and validates offline',()=>{
 const builder=new SupportBundleBuilder();
 const input={createdAt:'2026-08-24T00:00:00.000Z',pseudonymSalt:'test-salt',entries:[{path:'evidence/platform-snapshot-a.json',value:{botId:'bot-01',username:'Alice',safe:1}}]};
 const first=builder.build(input);const second=builder.build(input);
 assert.equal(first.version,2);assert.equal(first.manifestHash,second.manifestHash);assert.equal(first.files[0].sha256,second.files[0].sha256);
 assert.doesNotMatch(first.files[0].content,/bot-01|Alice/);assert.equal(SupportBundleBuilder.validate(first).valid,true);
 const tampered=JSON.parse(JSON.stringify(first));tampered.files[0].content+='x';assert.equal(SupportBundleBuilder.validate(tampered).valid,false);
});

test('XP-011 optional oversize evidence becomes a manifest warning and preview has no content',()=>{
 const builder=new SupportBundleBuilder({maxEntryBytes:256,maxTotalBytes:512});
 const input={createdAt:'2026-08-24T00:00:00.000Z',entries:[{path:'evidence/platform-snapshot-a.json',value:{ok:true}},{path:'evidence/log-summary-a.json',content:'x'.repeat(300),optional:true}]};
 const bundle=builder.build(input);assert.equal(bundle.entryCount,1);assert.equal(bundle.warnings[0].code,'SUPPORT_BUNDLE_ENTRY_TOO_LARGE');
 const preview=builder.preview(input);assert.equal(Object.hasOwn(preview.files[0],'content'),false);
});

test('XP-011 cancellation is checked between evidence adapters',()=>{
 const error=Object.assign(new Error('cancelled'),{code:'CANCELLED'});
 assert.throws(()=>new SupportBundleBuilder().build({entries:[{path:'evidence/trace-a.json',value:{}}],cancellationToken:{throwIfCancelled(){throw error;}}}),value=>value===error);
});

test('R1 hardening preserves repeated references and validates manifest entryCount',()=>{
 const shared={botId:'bot-01',value:7};
 const bundle=new SupportBundleBuilder().build({createdAt:'2026-08-24T00:00:00.000Z',pseudonymSalt:'fixed',entries:[{path:'evidence/trace-shared.json',value:{left:shared,right:shared}}]});
 const content=JSON.parse(bundle.files[0].content);
 assert.equal(content.left.value,7);assert.equal(content.right.value,7);assert.notEqual(content.right,'[Circular]');
 const invalid=JSON.parse(JSON.stringify(bundle));invalid.entryCount=99;
 assert.deepEqual(SupportBundleBuilder.validate(invalid).errors.includes('entryCount'),true);
});
