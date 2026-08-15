'use strict';
class TeleportListener{constructor({client,eventBus,botId,generation}){Object.assign(this,{client,eventBus,botId,generation});this.handler=()=>eventBus.emit('movement:teleport',{botId,generation,position:client.entity?.position});}start(){this.client.on('forcedMove',this.handler);}stop(){this.client.off('forcedMove',this.handler);}}
module.exports=TeleportListener;
