'use strict';
class DeathListener{constructor({client,eventBus,botId,generation}){Object.assign(this,{client,eventBus,botId,generation});this.handler=()=>eventBus.emit('player:death',{botId,generation});}start(){this.client.on('death',this.handler);}stop(){this.client.off('death',this.handler);}}
module.exports=DeathListener;
