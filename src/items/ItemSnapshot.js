'use strict';
const {immutableClone}=require('../shared/utils/object');
class ItemSnapshot{constructor(data){Object.assign(this,immutableClone(data));Object.freeze(this);}}
module.exports=ItemSnapshot;
