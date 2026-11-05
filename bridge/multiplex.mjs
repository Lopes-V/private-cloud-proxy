import { Duplex } from 'node:stream';
import { WebSocket } from 'ws';

// A small, bounded, versioned binary multiplexer. Each channel preserves
// independent TCP half-close, error handling, byte accounting, and flow control.
const OPEN=1, READY=2, DATA=3, END=4, RESET=5, CREDIT=6;
const FRAME_HEADER=5, MAX_DATA=16*1024, WINDOW=64*1024;
const MAX_BUFFERED=4*1024*1024;
const FAILURE_SET=new Set(['DNS_FAILED','DNS_REJECTED','TCP_CONNECT_TIMEOUT',
  'TCP_CONNECTION_REFUSED','NETWORK_UNREACHABLE','SESSION_LIMIT',
  'SESSION_QUOTA','TRAFFIC_LIMIT','INTERNAL_ERROR']);

function fail(failure='INTERNAL_ERROR', retryable=false) {
  return Object.assign(new Error('Multiplexed tunnel unavailable'), {failure,retryable});
}

class VirtualChannel extends Duplex {
  constructor(peer, id, sendCredit=0) {
    super({ readableHighWaterMark:WINDOW, writableHighWaterMark:WINDOW, allowHalfOpen:true });
    this.peer=peer;this.id=id;this.sendCredit=sendCredit;
    this.receiveCredit=WINDOW;this.ready=false;this.remoteEnded=false;
    this.pendingWrite=null;this.pendingOpen=null;this.remoteReset=false;
    this.on('error',()=>{}); // The pipe owner handles connection failure.
  }
  _read() { this.replenish(); }
  replenish() {
    if (!this.ready || this.remoteEnded || this.destroyed) return;
    if (this.receiveCredit<=WINDOW/2 && this.readableLength<=WINDOW/2) {
      const granted=WINDOW-this.receiveCredit;
      this.receiveCredit+=granted;
      const b=Buffer.allocUnsafe(4);b.writeUInt32BE(granted);
      this.peer.send(CREDIT,this.id,b,error=>{if(error)this.destroy(error);});
    }
  }
  _write(chunk, _encoding, callback) {
    if(chunk.length===0){callback();return;}
    this.pendingWrite={data:Buffer.from(chunk),offset:0,callback};
    this.flush();
  }
  flush() {
    const job=this.pendingWrite;
    if(!job||!this.ready||this.destroyed||this.sendCredit<=0)return;
    const remaining=job.data.length-job.offset;
    if(!remaining){this.pendingWrite=null;job.callback();return;}
    const count=Math.min(MAX_DATA,this.sendCredit,remaining);
    this.sendCredit-=count;
    const part=job.data.subarray(job.offset,job.offset+count);job.offset+=count;
    this.peer.send(DATA,this.id,part,error=>{
      if(error){this.destroy(error);return;}
      if(job!==this.pendingWrite)return;
      if(job.offset===job.data.length){this.pendingWrite=null;job.callback();}
      else this.flush();
    });
  }
  _final(callback) {
    if(this.peer.closed)return callback(new Error('Multiplex connection closed'));
    this.peer.send(END,this.id,Buffer.alloc(0),callback);
  }
  _destroy(error, callback) {
    this.peer.channels.delete(this.id);
    if(this.pendingWrite){
      const job=this.pendingWrite;this.pendingWrite=null;
      job.callback(error || new Error('Multiplex channel closed'));
    }
    if(this.pendingOpen){
      const pending=this.pendingOpen;this.pendingOpen=null;
      pending.reject(error||fail('INTERNAL_ERROR'));
    }
    if(!this.remoteReset&&!this.peer.closed) {
      this.peer.send(RESET,this.id,Buffer.alloc(0),()=>{});
    }
    callback(error);
  }
  receiveData(payload) {
    if(!this.ready||this.remoteEnded||payload.length===0||
       payload.length>MAX_DATA||payload.length>this.receiveCredit){
      this.peer.terminate();
      return;
    }
    this.receiveCredit-=payload.length;
    if(this.push(payload))this.replenish();
  }
  receiveCreditBytes(payload) {
    if(payload.length!==4)return this.peer.terminate();
    const extra=payload.readUInt32BE(0);
    if(extra===0||extra>WINDOW||this.sendCredit+extra>2*WINDOW)return this.peer.terminate();
    this.sendCredit+=extra;this.flush();
  }
  accept() {
    if(this.destroyed||this.ready)return;
    this.ready=true;
    this.peer.send(READY,this.id,Buffer.from(JSON.stringify({ok:true,window:WINDOW})),error=>{
      if(error)this.destroy(error);
    });
  }
  reject(failure='INTERNAL_ERROR') {
    if(this.destroyed)return;
    const code=FAILURE_SET.has(failure)?failure:'INTERNAL_ERROR';
    this.peer.send(READY,this.id,Buffer.from(JSON.stringify({ok:false,failure:code})),()=>{});
    this.remoteReset=true;
    this.destroy();
  }
}

export class MuxPeer {
  constructor(ws,{role='client',maxChannels=16,onOpen}={}) {
    if(!['client','server'].includes(role))throw new Error('Invalid multiplex role');
    if(!Number.isInteger(maxChannels)||maxChannels<1||maxChannels>128)
      throw new Error('Invalid multiplex channel limit');
    this.ws=ws;this.role=role;this.maxChannels=maxChannels;this.onOpen=onOpen;
    this.channels=new Map();this.nextId=1;this.closed=false;
    ws.on('message',(data,binary)=>{
      if(!binary)return this.terminate();
      this.receive(Buffer.from(data));
    });
    ws.on('close',()=>this.shutdown());
    ws.on('error',()=>this.shutdown());
  }
  send(type,id,payload,callback=()=>{}) {
    if(this.closed||this.ws.readyState!==WebSocket.OPEN){
      callback(new Error('Multiplex socket is closed'));return;
    }
    if(!Buffer.isBuffer(payload)||payload.length>MAX_DATA||id<1||id>0xffffffff){
      callback(new Error('Invalid multiplex frame'));return;
    }
    const buffer=Buffer.allocUnsafe(FRAME_HEADER+payload.length);
    buffer[0]=type;buffer.writeUInt32BE(id,1);payload.copy(buffer,FRAME_HEADER);
    if(this.ws.bufferedAmount+buffer.length>MAX_BUFFERED){
      this.terminate();callback(new Error('Multiplex send buffer exhausted'));return;
    }
    try { this.ws.send(buffer,{binary:true,compress:false},error=>{
      if(error)this.terminate();
      callback(error||null);
    });}
    catch(error){this.terminate();callback(error);}
  }
  receive(frame) {
    if(this.closed||frame.length<FRAME_HEADER||frame.length>MAX_DATA+FRAME_HEADER)
      return this.terminate();
    const type=frame[0],id=frame.readUInt32BE(1),payload=frame.subarray(FRAME_HEADER);
    if(id===0)return this.terminate();
    if(type===OPEN) {
      if(this.role!=='server'||this.channels.has(id)||
         payload.length===0||payload.length>1024)return this.terminate();
      if(this.channels.size>=this.maxChannels){
        this.send(READY,id,Buffer.from(JSON.stringify({ok:false,failure:'SESSION_LIMIT'})),()=>{});
        return;
      }
      let data;
      try { data=JSON.parse(payload.toString('utf8')); }
      catch { return this.terminate(); }
      if(!data||typeof data.host!=='string'||data.host.length<1||
         data.host.length>253||!Number.isInteger(data.port)||
         data.port<1||data.port>65535||data.window!==WINDOW)
        return this.terminate();
      const channel=new VirtualChannel(this,id,WINDOW);
      this.channels.set(id,channel);
      Promise.resolve().then(()=>this.onOpen?.({host:data.host,port:data.port,channel}))
        .catch(()=>channel.reject('INTERNAL_ERROR'));
      return;
    }
    const channel=this.channels.get(id);
    if(!channel)return; // Late frames for a cancelled channel are harmless.
    if(type===READY) {
      if(this.role!=='client'||!channel.pendingOpen||payload.length>1024)return this.terminate();
      let data;
      try { data=JSON.parse(payload.toString('utf8')); }
      catch { return this.terminate(); }
      const pending=channel.pendingOpen;channel.pendingOpen=null;
      if(data?.ok===true&&data.window===WINDOW){
        channel.ready=true;channel.sendCredit=WINDOW;
        pending.resolve(channel);channel.flush();return;
      }
      const code=FAILURE_SET.has(data?.failure)?data.failure:'INTERNAL_ERROR';
      pending.reject(fail(code,code==='SESSION_LIMIT'));
      channel.remoteReset=true;channel.destroy();return;
    }
    if(type===DATA)return channel.receiveData(payload);
    if(type===CREDIT)return channel.receiveCreditBytes(payload);
    if(type===END){
      if(payload.length||channel.remoteEnded)return this.terminate();
      channel.remoteEnded=true;channel.push(null);return;
    }
    if(type===RESET){
      if(payload.length)return this.terminate();
      channel.remoteReset=true;channel.destroy();return;
    }
    this.terminate();
  }
  open(host,port,{timeoutMs=10_000,signal}={}) {
    if(this.role!=='client'||this.closed||signal?.aborted)
      return Promise.reject(fail('WSS_CONNECTION_FAILED'));
    if(this.channels.size>=this.maxChannels)return Promise.reject(fail('SESSION_LIMIT',true));
    const id=this.nextId++;
    if(this.nextId>0xffffffff)this.nextId=1;
    if(this.channels.has(id))return Promise.reject(fail('SESSION_LIMIT',true));
    const channel=new VirtualChannel(this,id);
    this.channels.set(id,channel);
    return new Promise((resolve,reject)=>{
      let finished=false;
      const done=(error,value)=>{
        if(finished)return;finished=true;clearTimeout(timer);
        signal?.removeEventListener('abort',onAbort);
        channel.pendingOpen=null;
        if(error)reject(error);else resolve(value);
      };
      const onAbort=()=>{
        done(fail('QUEUE_CANCELLED'));
        channel.destroy();
      };
      const timer=setTimeout(()=>{
        done(fail('TCP_CONNECT_TIMEOUT',true));
        channel.destroy();
      },Math.max(1,timeoutMs));
      channel.pendingOpen={resolve:value=>done(null,value),reject:error=>done(error)};
      signal?.addEventListener('abort',onAbort,{once:true});
      if(signal?.aborted)return onAbort();
      this.send(OPEN,id,Buffer.from(JSON.stringify({host,port,window:WINDOW})),error=>{
        if(error){done(fail('WSS_CONNECTION_FAILED',true));channel.destroy();}
      });
    });
  }
  shutdown() {
    if(this.closed)return;
    this.closed=true;
    for(const channel of [...this.channels.values()]){
      channel.remoteReset=true;
      channel.destroy(new Error('Shared multiplex connection closed'));
    }
    this.channels.clear();
  }
  terminate() {
    this.shutdown();
    if(this.ws.readyState!==WebSocket.CLOSED)this.ws.terminate();
  }
  close() {
    this.shutdown();
    if(this.ws.readyState===WebSocket.OPEN)this.ws.close(1000);
    else if(this.ws.readyState!==WebSocket.CLOSED)this.ws.terminate();
  }
}
