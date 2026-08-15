'use strict';
class WindowOpenListener{constructor({client,handler}){this.client=client;this.handler=handler;}start(){this.client.on('windowOpen',this.handler);}stop(){this.client.off('windowOpen',this.handler);}}
module.exports=WindowOpenListener;
