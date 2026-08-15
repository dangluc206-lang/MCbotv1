'use strict';
const StateStore=require('../core/StateStore');
class GuiState extends StateStore{constructor(){super({window:null,sessionId:null,lastUpdateAt:null,revision:0});}}
module.exports=GuiState;
