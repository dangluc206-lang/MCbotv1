'use strict';
class SlotRegistry{constructor(layouts={}){this.layouts=layouts;}get(guiId,key){const value=this.layouts?.[guiId]?.[key];return Number.isInteger(value)?value:null;}}
module.exports=SlotRegistry;
