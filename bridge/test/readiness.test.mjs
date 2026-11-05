import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import {WebSocket} from 'ws';
import {fixture,SECRET} from './fixtures.mjs';
import {createLocalProxy} from '../client.mjs';
test('readiness validates authentication and remaining quota using the real relay',async()=>{
 const f=await fixture();
 try{const usage=await f.client.checkRelay();assert.equal(usage.active,0);assert.ok(usage.processLimit>usage.bytes);assert.equal(f.relay.usage().sessions,0);}
 finally{await f.close();}
});
test('readiness fails closed for invalid authentication, TLS trust and insufficient quota',async()=>{
 for(const [options,failure] of [[{clientOptions:{secret:'invalid-secret-at-least-32-characters'}},'AUTH_FAILED'],[{clientOptions:{ca:undefined}},'WSS_CONNECTION_FAILED'],[{relayOptions:{processBytes:8191}},'TRAFFIC_LIMIT']]){
  const f=await fixture(options);
  try{await assert.rejects(f.client.checkRelay(),e=>e.failure===failure);assert.equal(f.relay.usage().sessions,0);}
  finally{await f.close();}
 }
});
test('nearly exhausted quota is rejected before opening a tunnel',async()=>{
 const f=await fixture({relayOptions:{processBytes:8191}});let ws;
 try{
  const rejected=new Promise((resolve,reject)=>{
   ws=new WebSocket(`wss://localhost:${f.relayPort}/tunnel`,{ca:fs.readFileSync(`${f.dir}/ca.pem`),headers:{Authorization:'Bearer '+SECRET}});ws.on('error',()=>{});
   ws.once('unexpected-response',(_req,res)=>{res.resume();resolve({status:res.statusCode,failure:res.headers['x-tunnel-failure']});ws.terminate();});
   ws.once('open',()=>{ws.terminate();reject(new Error('nearly empty budget admitted a tunnel'));});
  });assert.deepEqual(await rejected,{status:429,failure:'TRAFFIC_LIMIT'});assert.equal(f.relay.usage().sessions,0);
 }finally{ws?.terminate();await f.close();}
});
test('readiness enforces an absolute deadline and bounded response body',async()=>{
 const f=await fixture();let mode='timeout';const sockets=new Set();
 const server=https.createServer(f.tls,(_req,res)=>{if(mode==='large')res.end('x'.repeat(17000));});server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const client=createLocalProxy({endpoint:`wss://localhost:${server.address().port}/tunnel`,secret:SECRET,ca:fs.readFileSync(`${f.dir}/ca.pem`),proxyEnv:{},diagnostic:()=>{}});
 try{
  const start=performance.now();await assert.rejects(client.checkRelay({timeoutMs:50}));assert.ok(performance.now()-start<1000);
  mode='large';await assert.rejects(client.checkRelay());
 }finally{await client.close();for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));await f.close();}
});

test('queued requests stop dialing after the first exhausted-quota rejection',async()=>{
 const events=[];const f=await fixture({relayOptions:{processBytes:8191,diagnostic:event=>events.push(event)},clientOptions:{maxSessions:1,diagnostic:()=>{}}});
 try{
  const {request}=await import('./fixtures.mjs');
  const responses=await Promise.all(Array.from({length:10},()=>request(f)));
  assert.ok(responses.every(res=>res.status===502));
  assert.equal(events.filter(event=>event.failure==='TRAFFIC_LIMIT').length,1,'queued requests must not repeat a known quota rejection');
  assert.equal(f.client.budget.used,8192,'only the first attempted tunnel may spend its reservation');
 }finally{await f.close();}
});
