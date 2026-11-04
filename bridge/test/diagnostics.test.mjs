import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WebSocket } from 'ws';
import { fixture, SECRET, request } from './fixtures.mjs';

test('DNS deadline sends a classified verdict and never dials a late answer', async () => {
  const events=[];
  const f=await fixture({relayOptions:{connectMs:40,diagnostic:e=>events.push(e),resolve:async()=>{await new Promise(r=>setTimeout(r,150));return '127.0.0.1';}}});
  try {
    const verdict=await new Promise((resolve,reject)=>{
      const ws=new WebSocket(`wss://localhost:${f.relayPort}/tunnel`,{ca:fs.readFileSync(`${f.dir}/ca.pem`),headers:{Authorization:`Bearer ${SECRET}`}});
      ws.on('error',reject);ws.once('open',()=>ws.send(JSON.stringify({host:'example.com',port:f.httpPort})));
      ws.once('message',m=>{resolve(JSON.parse(m));ws.terminate();});
      ws.once('close',()=>reject(new Error('Transport closed without verdict')));
    });
    assert.equal(verdict.ready,false);assert.equal(verdict.failure,'DNS_FAILED');
    await new Promise(r=>setTimeout(r,180));
    assert.equal(f.hits(),0);assert.equal(f.relay.usage().active,0);
    assert.ok(events.some(e=>e.failure==='DNS_FAILED' && e.durationMs>=30 && /^[a-f0-9-]{36}$/.test(e.id)));
  } finally {await f.close();}
});

test('client preserves sanitized remote failure classification', async()=>{
  const events=[];
  const f=await fixture({relayOptions:{resolve:async()=>{throw Object.assign(new Error('sensitive'),{code:'ENOTFOUND'});}},clientOptions:{diagnostic:e=>events.push(e)}});
  try {assert.equal((await request(f)).status,502);assert.ok(events.some(e=>e.failure==='DNS_FAILED'));assert.doesNotMatch(JSON.stringify(events),/sensitive|remote-only|test-secret/);}
  finally {await f.close();}
});

import { classify } from '../diagnostics.mjs';
test('stage classification distinguishes all required failure categories',()=>{
  for(const [stage,code,expected] of [
    ['dns','ENOTFOUND','DNS_FAILED'],['dns','DNS_REJECTED','DNS_REJECTED'],
    ['tcp_timeout','ETIMEDOUT','TCP_CONNECT_TIMEOUT'],['tcp','ECONNREFUSED','TCP_CONNECTION_REFUSED'],
    ['tcp','ENETUNREACH','NETWORK_UNREACHABLE'],['tcp','EHOSTUNREACH','NETWORK_UNREACHABLE'],
    ['wss','ECONNREFUSED','WSS_CONNECTION_FAILED'],['opening_timeout','ETIMEDOUT','WSS_CONNECTION_FAILED'],
    ['connected','ECONNRESET','REMOTE_SOCKET_CLOSED'],['opening',undefined,'INTERNAL_ERROR']
  ]) assert.equal(classify(stage,{code}),expected);
});
test('authenticated upgrade distinguishes session and traffic limits at the client',async()=>{
  for(const [options,failure] of [[{dailySessions:0},'SESSION_LIMIT'],[{processBytes:1},'TRAFFIC_LIMIT']]) {
    const events=[];const f=await fixture({relayOptions:options,clientOptions:{diagnostic:e=>events.push(e)}});
    try {
      if(failure==='TRAFFIC_LIMIT') {
        await new Promise((resolve,reject)=>{
          const ws=new WebSocket(`wss://localhost:${f.relayPort}/tunnel`,{ca:fs.readFileSync(`${f.dir}/ca.pem`),headers:{Authorization:`Bearer ${SECRET}`}});
          ws.on('error',reject);ws.once('open',()=>ws.send(JSON.stringify({host:'example.com',port:f.httpPort})));
          ws.once('message',()=>{ws.send(Buffer.from('G')); const deadline=setTimeout(()=>{clearInterval(poll);ws.terminate();reject(new Error('Traffic fixture deadline'));},1000); const poll=setInterval(()=>{if(f.relay.usage().bytes===1){clearTimeout(deadline);clearInterval(poll);ws.terminate();resolve();}},5);});
        });
      }
      assert.equal((await request(f)).status,502);assert.ok(events.some(e=>e.failure===failure));assert.equal(f.hits(),0);
    }
    finally {await f.close();}
  }
});
