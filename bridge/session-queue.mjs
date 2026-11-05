// Bounded per-client admission, no sockets/bandwidth allocated to waiting items.
const failure=code=>Object.assign(new Error(code),{failure:code,retryable:false});
export class SessionQueue {
 constructor({limit=8,maxPending=32,waitMs=15000}={}){
  if(!Number.isInteger(limit)||limit<0||!Number.isInteger(maxPending)||maxPending<0||!Number.isFinite(waitMs)||waitMs<=0)throw new Error('Invalid queue configuration');
  this.limit=limit;this.maxPending=maxPending;this.waitMs=waitMs;this.active=0;this.pending=[];this.closed=false;
 }
 stats(){return{active:this.active,waiting:this.pending.length};}
 acquire({signal}={}){
  if(this.closed||signal?.aborted)return Promise.reject(failure('QUEUE_CANCELLED'));
  if(this.limit===0)return Promise.reject(failure('SESSION_LIMIT'));
  if(this.active<this.limit&&this.pending.length===0){this.active++;return Promise.resolve(this.releaseToken());}
  if(this.pending.length>=this.maxPending)return Promise.reject(failure('QUEUE_FULL'));
  return new Promise((resolve,reject)=>{
   const item={resolve,reject,signal};
   const remove=code=>{const index=this.pending.indexOf(item);if(index<0)return;this.pending.splice(index,1);item.clean();reject(failure(code));};
   const abort=()=>remove('QUEUE_CANCELLED');
   const timer=setTimeout(()=>remove('QUEUE_TIMEOUT'),this.waitMs);
   item.clean=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
   this.pending.push(item);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
 }
 releaseToken(){let released=false;return()=>{if(released)return;released=true;this.active--;this.drain();};}
 drain(){
  while(!this.closed&&this.active<this.limit&&this.pending.length){
   const item=this.pending.shift();item.clean();
   if(item.signal?.aborted){item.reject(failure('QUEUE_CANCELLED'));continue;}
   this.active++;item.resolve(this.releaseToken());
  }
 }
 close(){if(this.closed)return;this.closed=true;for(const item of this.pending.splice(0)){item.clean();item.reject(failure('QUEUE_CANCELLED'));}}
}
