'use strict';
class SlotInspector{constructor({normalizer}){this.normalizer=normalizer;}inspect(window,slot){const item=window?.slots?.[slot];return item?{slot,item:this.normalizer.normalize(item)}:{slot,item:null};}}
module.exports=SlotInspector;
