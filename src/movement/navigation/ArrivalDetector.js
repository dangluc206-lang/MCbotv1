'use strict';
class ArrivalDetector{constructor({positionService,defaultRadius=1.5}){this.positionService=positionService;this.defaultRadius=defaultRadius;}arrived(destination,radius=this.defaultRadius){return this.positionService.distance(this.positionService.current(),destination)<=radius;}}
module.exports=ArrivalDetector;
