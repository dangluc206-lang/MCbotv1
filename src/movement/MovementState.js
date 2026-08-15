'use strict';
const StateStore=require('../core/StateStore');
class MovementState extends StateStore{constructor(){super({moving:false,destination:null,lastPosition:null,stuck:false});}}
module.exports=MovementState;
