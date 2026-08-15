'use strict';
class MessageListener{constructor({client,eventBus,botId,generation}){Object.assign(this,{client,eventBus,botId,generation});this.handler=message=>eventBus.emit('command:message',{botId,generation,message:String(message)});}start(){this.client.on('message',this.handler);}stop(){this.client.off('message',this.handler);}}
module.exports=MessageListener;
