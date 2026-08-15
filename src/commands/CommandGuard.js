'use strict';
class CommandGuard{constructor({context,minimumIntervalMs=250}){this.context=context;this.minimumIntervalMs=minimumIntervalMs;this.lastSentAt=0;}assert(command){this.context.require();if(typeof command!=='string'||!command.startsWith('/'))throw new TypeError('Resolved server command must start with /.');const wait=Math.max(0,this.minimumIntervalMs-(Date.now()-this.lastSentAt));return wait;}markSent(){this.lastSentAt=Date.now();}}
module.exports=CommandGuard;
