'use strict';
class OperationQueue{constructor(){this.tail=Promise.resolve();this.closed=false;this.pending=0;}enqueue(task){if(this.closed)return Promise.reject(new Error('Operation queue is closed.'));this.pending+=1;const run=this.tail.then(()=>task());this.tail=run.catch(()=>{}).finally(()=>{this.pending-=1;});return run;}async drain(){await this.tail;}close(){this.closed=true;}async destroy(){this.close();await this.drain();}}
module.exports=OperationQueue;
