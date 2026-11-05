import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import https from 'node:https';
import {WebSocketServer} from 'ws';
import {fixture,SECRET} from './fixtures.mjs';
import {createLocalProxy} from '../client.mjs';

// Real TLS/WebSocket transport with a minimal relay-protocol fixture. Its peer
// stays open after the HTTP reply, so the client must send a close control frame.
for(const mode of ['HTTP','CONNECT'])test(`${mode} tunnel sends a WebSocket close frame when the browser disconnects`,async()=>{
 const f=await fixture();let client;
 const server=https.createServer({...f.tls});
 const wss=new WebSocketServer({server});
 let closed;
 const closure=new Promise(resolve=>{closed=resolve;});
 wss.on('connection',ws=>{
  ws.once('close',code=>closed(code));
  ws.once('message',()=>{
   ws.send(JSON.stringify({ready:true}));
   ws.once('message',()=>ws.send(Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok')));
  });
 });
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  client=createLocalProxy({endpoint:`wss://localhost:${server.address().port}/tunnel`,secret:SECRET,ca:fs.readFileSync(`${f.dir}/ca.pem`),proxyEnv:{},diagnostic:()=>{}});
  const port=await client.listen();
  if(mode==='HTTP'){
   const status=await new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port,path:'http://example.com/'},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));}).on('error',reject));assert.equal(status,200);
  }else{
   const socket=net.connect(port,'127.0.0.1');socket.on('error',()=>{});await once(socket,'connect');
   socket.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n');
   const [reply]=await once(socket,'data');assert.match(reply.toString(),/200 Connection Established/);socket.resetAndDestroy();
  }
  const code=await Promise.race([closure,new Promise(resolve=>setTimeout(()=>resolve('TIMEOUT'),2000))]);
  assert.ok([1000,1005].includes(code),`peer must receive a normal close frame, got ${code}`);
 }finally{await client?.close();for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));await f.close();}
});
