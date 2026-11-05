import {test} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {fixture,SECRET} from './fixtures.mjs';

test('one browser can open 24 tunnels while eight relay cleanup slots remain bounded',async()=>{
 const f=await fixture();const sockets=[],peers=[];let timer;
 const raw=()=>new WebSocket(`wss://localhost:${f.relayPort}/tunnel`,{ca:fs.readFileSync(`${f.dir}/ca.pem`),headers:{Authorization:'Bearer '+SECRET}});
 try{
  const opening=Array.from({length:24},async()=>{
   const socket=net.connect(f.clientPort,'127.0.0.1');sockets.push(socket);socket.on('error',()=>{});await once(socket,'connect');
   socket.write(`CONNECT localhost:${f.httpPort} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
   const [response]=await once(socket,'data');assert.match(response.toString(),/^HTTP\/1\.1 200/);
  });
  await Promise.race([Promise.all(opening),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`only ${f.relay.usage().active} of 24 browser tunnels admitted before deadline`)),2000);})]);clearTimeout(timer);
  assert.equal(f.relay.usage().active,24);
  for(let i=0;i<8;i++){
   const ws=raw();peers.push(ws);ws.on('error',()=>{});await once(ws,'open');ws.send(JSON.stringify({host:'localhost',port:f.httpPort}));
   const [message]=await once(ws,'message');assert.equal(JSON.parse(message.toString()).ready,true);
  }
  assert.equal(f.relay.usage().active,32);
  const rejected=await new Promise((resolve,reject)=>{
   const ws=raw();peers.push(ws);ws.on('error',()=>{});ws.once('open',()=>reject(new Error('relay exceeded its bounded connection capacity')));
   ws.once('unexpected-response',(_req,res)=>{res.resume();ws.terminate();resolve({status:res.statusCode,failure:res.headers['x-tunnel-failure']});});
  });assert.deepEqual(rejected,{status:429,failure:'SESSION_LIMIT'});
 }finally{clearTimeout(timer);for(const socket of sockets)socket.destroy();for(const peer of peers)peer.terminate();await f.close();}
});
