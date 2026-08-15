'use strict';
class PositionListener{constructor({client,eventBus,botId,generation}){Object.assign(this,{client,eventBus,botId,generation});this.handler=()=>eventBus.emit('movement:position',{botId,generation,position:client.entity?.position});}start(){this.client.on('move',this.handler);}stop(){this.client.off('move',this.handler);}}
module.exports=PositionListener;
