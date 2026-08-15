'use strict';
const StateStore=require('../core/StateStore');
class BotState extends StateStore{constructor(){super({lifecycleState:'CREATED',connectionState:'DISCONNECTED',lastError:null,startedAt:null,stoppedAt:null});}}
module.exports=BotState;
