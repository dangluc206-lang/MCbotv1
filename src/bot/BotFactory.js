'use strict';
class BotFactory{
    constructor({clientFactory=null,plugins=[]}={}){this.clientFactory=clientFactory;this.plugins=[...plugins];}
    create(options){let factory=this.clientFactory;if(!factory){const mineflayer=require('mineflayer');factory=mineflayer.createBot;}const bot=factory(options);for(const plugin of this.plugins)bot.loadPlugin?.(plugin);return bot;}
}
module.exports=BotFactory;
