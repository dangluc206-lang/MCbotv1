'use strict';
const AppError=require('../../shared/errors/AppError');
class BotNotFoundError extends AppError{constructor(botId){super(`Bot runtime not found: ${botId}`,{code:'BOT_NOT_FOUND',details:{botId}});this.name='BotNotFoundError';}}
module.exports=BotNotFoundError;
