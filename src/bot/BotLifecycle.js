'use strict';
const LifecycleCoordinator=require('../core/LifecycleCoordinator');
class BotLifecycle extends LifecycleCoordinator{constructor(components=[],options={}){super(components,{name:'BotLifecycle',...options});}}
module.exports=BotLifecycle;
