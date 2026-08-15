'use strict';
class ChatListener{constructor({client,eventBus,botId,generation}){Object.assign(this,{client,eventBus,botId,generation});this.handler=(username,message)=>eventBus.emit('command:message',{botId,generation,username,message});}start(){this.client.on('chat',this.handler);}stop(){this.client.off('chat',this.handler);}}
module.exports=ChatListener;
