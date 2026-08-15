'use strict';
const BotNotReadyError=require('./errors/BotNotReadyError');
class BotContext{
    constructor(botId){if(typeof botId!=='string'||!botId.trim())throw new TypeError('botId is required');this.botId=botId;this.client=null;this.generation=0;}
    get(){return this.client;} has(){return Boolean(this.client);} require(){if(!this.client)throw new BotNotReadyError(this.botId);return this.client;}
    attach(bot){if(!bot||typeof bot!=='object')throw new TypeError('bot client is required');if(this.client)throw new Error(`Bot ${this.botId} already has an active client`);this.client=bot;this.generation+=1;return this.generation;}
    detach(expectedBot){if(!this.client||this.client!==expectedBot)return false;this.client=null;return true;}
    getGeneration(){return this.generation;}
}
module.exports=BotContext;
