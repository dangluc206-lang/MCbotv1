'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');const BotContext=require('../../../src/bot/BotContext');const GuiSession=require('../../../src/gui/GuiSession');const SlotValidator=require('../../../src/gui/slots/SlotValidator');const ClickGuard=require('../../../src/gui/click/ClickGuard');const ClickExecutor=require('../../../src/gui/click/ClickExecutor');
test('click pipeline rejects stale window and executes valid click',async()=>{const bot=new EventEmitter();bot.currentWindow={slots:[{}]};let clicked=null;bot.clickWindow=async(...args)=>{clicked=args;};const context=new BotContext('a');context.attach(bot);const session=new GuiSession({botId:'a',connectionGeneration:1,window:bot.currentWindow});const guard=new ClickGuard({context,slotValidator:new SlotValidator()});guard.assert({session,slot:0});await new ClickExecutor({context}).click({slot:0});assert.deepEqual(clicked,[0,0,0]);bot.currentWindow={slots:[{}]};assert.throws(()=>guard.assert({session,slot:0}),/window changed/);});

test('SlotResolver never resolves a GUI role from appended player inventory', () => {
    const SlotResolver = require('../../../src/gui/slots/SlotResolver');
    const slots = Array(90).fill(null);
    slots[89] = { logicalId: 'recipe' };
    const resolver = new SlotResolver({
        slotRegistry: { get: () => null },
        itemResolver: { matches: (item, id) => ({ matched: item?.logicalId === id }) }
    });
    assert.equal(resolver.resolve({ slots, inventoryStart: 54 }, {
        guiId: 'crafting', key: 'recipe', itemId: 'recipe', context: 'crafting-menu'
    }), -1);
});
