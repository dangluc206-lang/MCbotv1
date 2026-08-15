'use strict';
function inspectWindow(window){return{title:window?.title||null,type:window?.type||null,slotCount:window?.slots?.length||0,slots:(window?.slots||[]).map((item,slot)=>item?{slot,name:item.name,count:item.count,displayName:item.displayName||null}:null).filter(Boolean)};}
if(require.main===module){const input=process.argv[2];if(!input){console.error('Usage: node scripts/inspect-window.js <snapshot.json>');process.exitCode=1;}else{const snapshot=require(require('node:path').resolve(input));console.log(JSON.stringify(inspectWindow(snapshot),null,2));}}
module.exports={inspectWindow};
