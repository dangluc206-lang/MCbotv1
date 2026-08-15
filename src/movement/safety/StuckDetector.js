'use strict';
class StuckDetector{constructor({positionService,thresholdMs=5000,minDistance=0.3}){Object.assign(this,{positionService,thresholdMs,minDistance});this.last=null;this.lastMovedAt=Date.now();}update(){const current=this.positionService.current();if(!this.last||this.positionService.distance(this.last,current)>=this.minDistance){this.last=current;this.lastMovedAt=Date.now();return false;}return Date.now()-this.lastMovedAt>=this.thresholdMs;}}
module.exports=StuckDetector;
