'use strict';
class ClickGuard{constructor({context,slotValidator}){this.context=context;this.slotValidator=slotValidator;}assert({session,slot}){session.assertActive();const bot=this.context.require();if(bot.currentWindow!==session.window)throw new Error('GUI window changed before click.');if(session.generation!==this.context.getGeneration())throw new Error('GUI session belongs to a stale connection.');if(!this.slotValidator.validate(session.window,slot))throw new RangeError(`Invalid slot: ${slot}`);return true;}}
module.exports=ClickGuard;
