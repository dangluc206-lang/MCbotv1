'use strict';
class SlotValidator{validate(window,slot){return Number.isInteger(slot)&&slot>=0&&slot<(window?.slots?.length||0);}}
module.exports=SlotValidator;
