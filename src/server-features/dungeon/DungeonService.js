'use strict';
const Result=require('../../shared/result/Result');
const Status=require('../../shared/result/Status');
class DungeonService{constructor({operation}){this.operation=operation;}async enter(destinationId){try{return Result.ok(await this.operation.execute(destinationId));}catch(error){return Result.fail(Status.FAILED,error.message,error,{destinationId});}}}
module.exports=DungeonService;
