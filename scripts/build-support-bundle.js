'use strict';

const fs=require('node:fs');
const path=require('node:path');
const SupportBundleBuilder=require('../src/diagnostics/support/SupportBundleBuilder');

function main(){
 const args=process.argv.slice(2); const entries=[]; let botId=null, incidentId=null;
 for(let i=0;i<args.length;i+=1){
  const arg=args[i];
  if(arg==='--bot'){botId=args[++i]||null;continue;}
  if(arg==='--incident'){incidentId=args[++i]||null;continue;}
  if(arg==='--entry'){
   const spec=args[++i]||''; const split=spec.indexOf('='); if(split<=0)throw new Error('--entry requires bundle/path=source/file');
   const bundlePath=spec.slice(0,split); const source=path.resolve(process.cwd(),spec.slice(split+1));
   const stat=fs.statSync(source); if(!stat.isFile())throw new Error(`Support evidence source is not a file: ${source}`);
   entries.push({path:bundlePath,content:fs.readFileSync(source,'utf8')}); continue;
  }
  throw new Error(`Unknown support bundle argument: ${arg}`);
 }
 const bundle=new SupportBundleBuilder().build({botId,incidentId,entries});
 process.stdout.write(`${JSON.stringify(bundle,null,2)}\n`);
}
if(require.main===module){try{main();}catch(error){console.error(`[FAIL] ${error.code||'SUPPORT_BUNDLE'}: ${error.message}`);process.exitCode=1;}}
