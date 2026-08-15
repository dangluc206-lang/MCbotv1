'use strict';
class WindowMatcher{constructor({titleMatcher,layoutMatcher,fingerprintMatcher}){Object.assign(this,{titleMatcher,layoutMatcher,fingerprintMatcher});}match(window,definition={}){if(definition.title&&!this.titleMatcher.match(window,definition.title))return false;if(definition.layout&&!this.layoutMatcher.match(window,definition.layout))return false;for(const rule of definition.fingerprints||[])if(!this.fingerprintMatcher.match(window,rule))return false;return true;}}
module.exports=WindowMatcher;
