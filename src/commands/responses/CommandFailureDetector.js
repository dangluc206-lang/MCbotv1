'use strict';
class CommandFailureDetector{constructor({matcher,rules=[]}){this.matcher=matcher;this.rules=rules;}detect(message){return this.matcher.match(message,this.rules);}}
module.exports=CommandFailureDetector;
