'use strict';
function inspectInventory(slots=[]){return slots.map((item,slot)=>item?{slot,name:item.name,count:item.count,displayName:item.displayName||null}:null).filter(Boolean);}
if(require.main===module){const input=process.argv[2];if(!input){console.error('Usage: node scripts/inspect-inventory.js <snapshot.json>');process.exitCode=1;}else{const data=require(require('node:path').resolve(input));console.log(JSON.stringify(inspectInventory(data.slots||data),null,2));}}
module.exports={inspectInventory};
