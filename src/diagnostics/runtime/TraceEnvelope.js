'use strict';

const { randomUUID } = require('node:crypto');
const Redactor = require('../../shared/security/Redactor');

const CONTRACT='trace-envelope';
const VERSION=1;
function text(v){return v===undefined||v===null||v===''?null:String(v);}
function freeze(v){if(!v||typeof v!=='object'||Object.isFrozen(v))return v;for(const c of Object.values(v))freeze(c);return Object.freeze(v);}

class TraceEnvelope {
 static create(input={}, {now=Date.now}={}) {
  if(input?.contract && input.contract!==CONTRACT) throw Object.assign(new TypeError(`Unsupported trace contract: ${input.contract}`),{code:'TRACE_CONTRACT_UNSUPPORTED'});
  if(input?.version!==undefined && Number(input.version)!==VERSION) throw Object.assign(new TypeError(`Unsupported trace version: ${input.version}`),{code:'TRACE_VERSION_UNSUPPORTED'});
  const trace=Redactor.sanitize({
   contract:CONTRACT,version:VERSION,traceId:text(input.traceId||randomUUID()),parentTraceId:text(input.parentTraceId),
   botId:text(input.botId),connectionGeneration:Number.isInteger(Number(input.connectionGeneration))?Number(input.connectionGeneration):null,
   intentId:text(input.intentId),operationId:text(input.operationId),correlationId:text(input.correlationId||input.operationId||input.intentId),
   decisionDigest:text(input.decisionDigest),evidenceIds:Array.isArray(input.evidenceIds)?input.evidenceIds.map(String).slice(0,32):[],
   kind:text(input.kind||'runtime'),code:text(input.code),occurredAt:input.occurredAt||new Date(now()).toISOString(),details:input.details??null
  });
  return freeze(trace);
 }
 static read(value){return this.create(value);}
}
TraceEnvelope.CONTRACT=CONTRACT; TraceEnvelope.VERSION=VERSION;
module.exports=TraceEnvelope;
