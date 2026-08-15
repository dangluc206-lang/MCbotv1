'use strict';
const Timeout=require('../shared/time/Timeout');
class OperationTimeoutPolicy{run(promise,context){return Timeout.withTimeout(promise,context.timeoutMs,{cancellationToken:context.cancellation.token,message:`Operation ${context.operationId} timed out.`});}}
module.exports=OperationTimeoutPolicy;
