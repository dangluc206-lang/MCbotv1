'use strict';
class WindowUpdateListener{constructor({client,handler}){this.client=client;this.handler=handler;}start(){this.client.on('windowUpdate',this.handler);}stop(){this.client.off('windowUpdate',this.handler);}}
module.exports=WindowUpdateListener;
