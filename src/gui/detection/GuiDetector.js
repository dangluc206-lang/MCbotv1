'use strict';
class GuiDetector{constructor({registry,windowMatcher}){this.registry=registry;this.windowMatcher=windowMatcher;}detect(window){for(const [id,definition] of this.registry.entries())if(this.windowMatcher.match(window,definition))return{id,definition};return null;}}
module.exports=GuiDetector;
