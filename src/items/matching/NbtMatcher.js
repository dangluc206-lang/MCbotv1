'use strict';
function find(node,path){return path.split('.').reduce((value,key)=>value?.value?.[key]??value?.[key],node);}
class NbtMatcher{match(item,rule){const actual=find(item.nbt,rule.path||'');return{matched:String(actual?.value??actual??'')===String(rule.value??''),strength:'VERY_STRONG',field:`nbt.${rule.path}`};}}
module.exports=NbtMatcher;
