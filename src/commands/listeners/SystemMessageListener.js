'use strict';
class SystemMessageListener{constructor({client,eventBus,botId,generation}){Object.assign(this,{client,eventBus,botId,generation});this.handler=message=>eventBus.emit('command:message',{botId,generation,message:String(message),system:true});}start(){this.client.on('messagestr',this.handler);}stop(){this.client.off('messagestr',this.handler);}}
module.exports=SystemMessageListener;
