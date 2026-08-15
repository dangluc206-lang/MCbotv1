'use strict';
const AppError=require('../../shared/errors/AppError');
class BotAlreadyExistsError extends AppError{constructor(botId){super(`Bot runtime already exists: ${botId}`,{code:'BOT_ALREADY_EXISTS',details:{botId}});this.name='BotAlreadyExistsError';}}
module.exports=BotAlreadyExistsError;
