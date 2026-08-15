'use strict';
class ControlStateManager{constructor({context}){this.context=context;this.active=new Set();}set(control,value){const bot=this.context.require();bot.setControlState(control,Boolean(value));if(value)this.active.add(control);else this.active.delete(control);}clear(){const bot=this.context.get();if(bot)for(const control of this.active)bot.setControlState(control,false);this.active.clear();}async stop(){this.clear();}async destroy(){this.clear();}}
module.exports=ControlStateManager;
