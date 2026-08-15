'use strict';
class WindowCloseListener{constructor({client,handler}){this.client=client;this.handler=handler;}start(){this.client.on('windowClose',this.handler);}stop(){this.client.off('windowClose',this.handler);}}
module.exports=WindowCloseListener;
