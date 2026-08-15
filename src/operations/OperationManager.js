'use strict';
const OperationContext=require('./OperationContext');
class OperationManager{
    constructor({botId,queue,lockPolicy,timeoutPolicy,logger=null}){Object.assign(this,{botId,queue,lockPolicy,timeoutPolicy,logger});this.sequence=0;this.active=new Map();}
    run(operation,{timeoutMs=30000,metadata=null,cancellationToken=null}={}){const operationId=`${this.botId}:${++this.sequence}`;const context=new OperationContext({operationId,botId:this.botId,timeoutMs,metadata,logger:this.logger});const unsubscribe=cancellationToken?.onCancelled?.(reason=>context.cancel(reason))||(()=>{});this.active.set(operationId,context);return this.queue.enqueue(()=>operation.run(context,{lockPolicy:this.lockPolicy,timeoutPolicy:this.timeoutPolicy})).finally(()=>{unsubscribe();this.active.delete(operationId);});}
    cancel(operationId,reason){return this.active.get(operationId)?.cancel(reason)||false;}
    cancelAll(reason='Operations cancelled.'){
        let cancelled=0;
        for(const context of this.active.values()){
            if(context.cancel(reason)) cancelled+=1;
        }
        return cancelled;
    }
    snapshot(){return Object.freeze({active:this.active.size,pending:Number(this.queue?.pending||0),operationIds:Object.freeze([...this.active.keys()])});}
    async stop(){this.cancelAll('Runtime stopping');this.queue.close();await this.queue.drain();this.lockPolicy.clear();}
    async destroy(){await this.stop();}
}
module.exports=OperationManager;
