'use strict';
class SlotFingerprintMatcher{constructor({itemResolver}){this.itemResolver=itemResolver;}match(window,rule={}){const item=window?.slots?.[rule.slot];if(!item)return false;return this.itemResolver.matches(item,rule.itemId,rule.context||'gui').matched;}}
module.exports=SlotFingerprintMatcher;
