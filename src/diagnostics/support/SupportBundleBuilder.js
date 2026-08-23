'use strict';

const Redactor=require('../../shared/security/Redactor');
const CONTRACT='support-bundle'; const VERSION=1;
const PROTECTED=/(^|\/)(?:\.[^/]+(?:\/|$)|data(?:\/|$)|node_modules(?:\/|$)|config\/bots(?:\/|$))/i;
const ALLOWED=[/^RELEASE_NOTES\.txt$/,/^architecture\/baseline\/current\.json$/,/^evidence\/(?:runtime-failure|health|mode-status|trace|replay)-[a-z0-9._-]+\.json$/i];
function freeze(v){if(!v||typeof v!=='object'||Object.isFrozen(v))return v;for(const c of Object.values(v))freeze(c);return Object.freeze(v);}
class SupportBundleBuilder{
 constructor({maxEntries=32,maxEntryBytes=256*1024,maxTotalBytes=1024*1024}={}){this.maxEntries=Math.max(1,Math.min(128,Number(maxEntries)||32));this.maxEntryBytes=Math.max(256,Number(maxEntryBytes)||256*1024);this.maxTotalBytes=Math.max(this.maxEntryBytes,Number(maxTotalBytes)||1024*1024);}
 build({botId=null,incidentId=null,entries=[]}={}){
  if(!Array.isArray(entries))throw new TypeError('Support bundle entries must be an array.');
  if(entries.length>this.maxEntries)throw Object.assign(new RangeError('Support bundle entry limit exceeded.'),{code:'SUPPORT_BUNDLE_ENTRY_LIMIT'});
  const files=[];let totalBytes=0;
  for(const entry of entries){const p=String(entry?.path||'').replace(/\\/g,'/').replace(/^\.\//,'');if(!p||p.includes('..')||p.startsWith('/')||PROTECTED.test(p)||!ALLOWED.some(x=>x.test(p)))throw Object.assign(new Error(`Support bundle path is not allowlisted: ${p||'<empty>'}`),{code:'SUPPORT_BUNDLE_PATH_BLOCKED',path:p});const value=Redactor.sanitize(entry.value??entry.content??null);const content=typeof value==='string'?Redactor.redactText(value):JSON.stringify(value,null,2);const bytes=Buffer.byteLength(content);if(bytes>this.maxEntryBytes)throw Object.assign(new RangeError(`Support bundle entry too large: ${p}`),{code:'SUPPORT_BUNDLE_ENTRY_TOO_LARGE',path:p,bytes});totalBytes+=bytes;if(totalBytes>this.maxTotalBytes)throw Object.assign(new RangeError('Support bundle total size limit exceeded.'),{code:'SUPPORT_BUNDLE_TOTAL_TOO_LARGE',bytes:totalBytes});files.push(Object.freeze({path:p,bytes,content}));}
  return freeze({contract:CONTRACT,version:VERSION,botId:botId==null?null:String(botId),incidentId:incidentId==null?null:String(incidentId),entryCount:files.length,totalBytes,files});
 }
}
SupportBundleBuilder.CONTRACT=CONTRACT;SupportBundleBuilder.VERSION=VERSION;SupportBundleBuilder.PROTECTED=PROTECTED;
module.exports=SupportBundleBuilder;