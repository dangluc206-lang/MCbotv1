'use strict';
class FallDetector{constructor({maxDrop=4}){this.maxDrop=maxDrop;this.lastY=null;}update(position){if(!position)return false;const falling=this.lastY!==null&&this.lastY-position.y>=this.maxDrop;this.lastY=position.y;return falling;}}
module.exports=FallDetector;
