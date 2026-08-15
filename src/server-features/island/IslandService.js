'use strict';
const Result=require('../../shared/result/Result');
const Status=require('../../shared/result/Status');
class IslandService{
    constructor({operation}){this.operation=operation;}
    async goHome({cancellationToken=null}={}){
        try{return Result.ok(await this.operation.execute({cancellationToken}));}
        catch(error){return Result.fail(error?.code==='CANCELLED'?Status.CANCELLED:Status.FAILED,error.message,error);}
    }
}
module.exports=IslandService;
