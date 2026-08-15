'use strict';
class OperationCancellation{static link(parentToken,childSource){if(!parentToken)return()=>{};return parentToken.onCancelled(reason=>childSource.cancel(reason));}}
module.exports=OperationCancellation;
