'use strict';
function inspectItem(item){return{name:item?.name||null,type:item?.type??null,count:item?.count??0,displayName:item?.displayName||null,lore:item?.lore||[],nbt:item?.nbt||null};}
if(require.main===module){const input=process.argv[2];if(!input){console.error('Usage: node scripts/inspect-item.js <item.json>');process.exitCode=1;}else console.log(JSON.stringify(inspectItem(require(require('node:path').resolve(input))),null,2));}
module.exports={inspectItem};
