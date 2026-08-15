'use strict';
class ClickExecutor{constructor({context}){this.context=context;}async click({slot,button=0,mode=0}){const bot=this.context.require();await bot.clickWindow(slot,button,mode);return{slot,button,mode};}}
module.exports=ClickExecutor;
