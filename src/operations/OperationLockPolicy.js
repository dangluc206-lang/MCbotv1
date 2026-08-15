'use strict';
class OperationLockPolicy{constructor(){this.owners=new Map();}
 acquire(keys,owner){const list=[...new Set(keys||[])].sort();for(const key of list){const current=this.owners.get(key);if(current&&current!==owner)return false;}for(const key of list)this.owners.set(key,owner);return true;}
 release(keys,owner){for(const key of keys||[])if(this.owners.get(key)===owner)this.owners.delete(key);}
 owner(key){return this.owners.get(key)||null;} clear(owner){for(const [key,value] of this.owners)if(!owner||value===owner)this.owners.delete(key);}}
module.exports=OperationLockPolicy;
