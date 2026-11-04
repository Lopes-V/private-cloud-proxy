import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { connectPinned } from '../connect.mjs';
import { resolvePublicAddresses } from '../policy.mjs';
import { fixture, request } from './fixtures.mjs';

test('DNS snapshot retains all public candidates, deduplicates and rejects any forbidden member',async()=>{
  let calls=0;
  assert.deepEqual(await resolvePublicAddresses('example.com',async()=>{calls++;return [{address:'2606:4700:4700::1111'},{address:'8.8.8.8'},{address:'1.1.1.1'},{address:'8.8.8.8'}];}),['8.8.8.8','1.1.1.1','2606:4700:4700::1111']);
  assert.equal(calls,1);
  for(const address of ['127.0.0.1','10.0.0.1','::ffff:8.8.8.8','169.254.169.254','fe80::1']) {
    await assert.rejects(resolvePublicAddresses('example.com',async()=>[{address:'8.8.8.8'},{address}]),{code:'DNS_REJECTED'});
  }
});

test('pinned connector rejects hostnames and falls back between numeric candidates',async()=>{
  assert.throws(()=>connectPinned(['example.com'],443));
  const sockets=new Set();const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let socket;
  try {
    socket=connectPinned(['::1','127.0.0.2','127.0.0.1'],server.address().port);
    await once(socket,'connect');assert.equal(socket.remoteAddress,'127.0.0.1');
  } finally {socket?.destroy();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}
});

test('stalled TCP is denied on the existing deadline and its socket destroyed',async()=>{
  let upstream;const events=[];
  const f=await fixture({relayOptions:{connectMs:50,connect:()=>upstream=new net.Socket(),diagnostic:e=>events.push(e)}});
  try {
    assert.equal((await request(f)).status,502);assert.equal(upstream.destroyed,true);
    assert.ok(events.some(e=>e.failure==='TCP_CONNECT_TIMEOUT'));
  } finally {await f.close();}
});

test('local session and traffic ceilings produce explicit diagnostics without dialing',async()=>{
  for(const [options,failure] of [[{maxSessions:0},'SESSION_LIMIT']]) {
    const events=[];const f=await fixture({clientOptions:{...options,diagnostic:e=>events.push(e)}});
    try {assert.equal((await request(f)).status,502);assert.ok(events.some(e=>e.failure===failure));assert.equal(f.relay.usage().sessions,0);}
    finally {await f.close();}
  }
});
