import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {fixture,request} from './fixtures.mjs';

test('requests above client concurrency wait and complete without raising the limit',async()=>{
 const f=await fixture({clientOptions:{maxSessions:1,maxQueued:4,queueWaitMs:2000}});
 try{const results=await Promise.all(Array.from({length:4},()=>request(f)));assert.deepEqual(results.map(r=>r.status),[200,200,200,200]);}
 finally{await f.close();}
});
test('cancelled waiting request never opens a remote tunnel',async()=>{
 const f=await fixture({clientOptions:{maxSessions:1,maxQueued:4,queueWaitMs:1000}});let socket;
 try{
  socket=net.connect(f.clientPort,'127.0.0.1');socket.on('error',()=>{});await once(socket,'connect');
  socket.write(`CONNECT localhost:${f.httpsPort} HTTP/1.1\r\nHost: localhost\r\n\r\n`);const [response]=await once(socket,'data');assert.match(response.toString(),/200/);
  const pending=http.get({host:'127.0.0.1',port:f.clientPort,path:`http://remote-only.invalid:${f.httpPort}/hello`});pending.on('error',()=>{});
  await new Promise(r=>setTimeout(r,30));pending.destroy();await new Promise(r=>setTimeout(r,30));socket.destroy();await new Promise(r=>setTimeout(r,80));
  assert.equal(f.relay.usage().sessions,1);
 }finally{socket?.destroy();await f.close();}
});
