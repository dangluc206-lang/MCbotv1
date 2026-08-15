'use strict';
const registerBotServices=require('./registerBotServices');
function createBotRuntime(options){return registerBotServices(options);}
module.exports=createBotRuntime;
