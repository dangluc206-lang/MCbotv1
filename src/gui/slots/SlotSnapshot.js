'use strict';
class SlotSnapshot{constructor({slot,item}){this.slot=slot;this.item=item?Object.freeze({...item}):null;Object.freeze(this);}}
module.exports=SlotSnapshot;
