'use strict';
const AppError=require('../../shared/errors/AppError');
class BotNotReadyError extends AppError{constructor(botId){super(`Bot is not connected: ${botId}`,{code:'BOT_NOT_READY',details:{botId}});this.name='BotNotReadyError';}}
module.exports=BotNotReadyError;
