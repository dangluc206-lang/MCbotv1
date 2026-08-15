'use strict';
class SlotUpdateListener{constructor({client,handler}){this.client=client;this.handler=handler;}start(){this.client.on('setSlot',this.handler);}stop(){this.client.off('setSlot',this.handler);}}
module.exports=SlotUpdateListener;
