'use strict';
class SlotResolver{constructor({slotRegistry,itemResolver}){Object.assign(this,{slotRegistry,itemResolver});}resolve(window,{guiId,key,itemId,context='gui'}){const configured=this.slotRegistry.get(guiId,key);if(configured!==null)return configured;if(itemId)return(window.slots||[]).findIndex(item=>item&&this.itemResolver.matches(item,itemId,context).matched);return-1;}}
module.exports=SlotResolver;
