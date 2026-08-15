'use strict';
const Result=require('../../shared/result/Result');
const Status=require('../../shared/result/Status');
class SmeltingService{
    constructor({operation}){this.operation=operation;}
    isAvailable(recipeId){return this.operation.isAvailable?.(recipeId)!==false;}
    async smelt(recipeId,options={}){try{return Result.ok(await this.operation.execute(recipeId,options));}catch(error){return Result.fail(Status.FAILED,error.message,error);}}
}
module.exports=SmeltingService;
