import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { fixture, request, curl } from './fixtures.mjs';

async function prepared(options={}) {
  const f=await fixture({clientOptions:{useMultiplex:true,...options}});
  await f.client.checkRelay();
  assert.equal(await f.client.primeTransport(),true);
  return f;
}

test('many logical HTTP requests reuse one authenticated WSS instead of one per CONNECT',async()=>{
  const f=await prepared();
  const urls=[];
  f.relay.server.on('upgrade',req=>urls.push(req.url));
  try{
    const results=await Promise.all(Array.from({length:10},()=>request(f)));
    assert.equal(results.length,10);
    assert.ok(results.every(r=>r.status===200&&r.body==='bridge-origin-ok'));
    assert.equal(f.relay.usage().sessions,10);
    assert.equal(urls.length,0,'Multiplex was established before the browser requests');
    assert.equal((await request(f)).status,200);
    assert.equal(f.relay.usage().sessions,11);
  }finally{await f.close();}
});

test('large HTTPS responses maintain stream flow control over shared WSS',async()=>{
  const payload='z'.repeat(512*1024);
  const f=await fixture({clientOptions:{useMultiplex:true},
    originHandler:(req,res)=>{
      if(req.url==='/big'){res.writeHead(200,{'Content-Type':'text/plain'});res.end(payload);return true;}
      return false;
    }});
  try{
    await f.client.checkRelay();await f.client.primeTransport();
    const [a,b]=await Promise.all([
      request(f,{url:'http://remote-only.invalid:'+f.httpPort+'/big'}),
      request(f,{url:'http://remote-only.invalid:'+f.httpPort+'/hello'})
    ]);
    assert.equal(a.status,200);
    assert.equal(a.body.length,payload.length);
    assert.equal(a.body,payload);
    assert.equal(b.status,200);
    const https=await curl(f);
    assert.match(https.stdout,/bridge-origin-ok/);
  }finally{await f.close();}
});

test('closing one CONNECT channel preserves concurrent channels and their shared WSS',async()=>{
  const f=await prepared({maxSessions:2,queueWaitMs:2500});
  let socket;
  try{
    socket=net.connect(f.clientPort,'127.0.0.1');socket.on('error',()=>{});
    await once(socket,'connect');
    const response=once(socket,'data');
    socket.write('CONNECT localhost:'+f.httpsPort+' HTTP/1.1\r\nHost: localhost\r\n\r\n');
    const [data]=await response;
    assert.match(data.toString('latin1'),/^HTTP\/1\.1 200 Connection Established/);
    assert.equal((await request(f)).status,200);
    socket.destroy();
    const resumed=await request(f);
    assert.equal(resumed.status,200);
    assert.equal(f.relay.usage().sessions,3);
  }finally{socket?.destroy();await f.close();}
});

test('multiplexed session still enforces DNS policy for private destinations',async()=>{
  const f=await fixture({secured:true,clientOptions:{useMultiplex:true}});
  try{
    await f.client.checkRelay();await f.client.primeTransport();
    const result=await request(f,{url:'http://127.0.0.1:'+f.httpPort+'/hello'});
    assert.equal(result.status,502);
    assert.equal(f.hits(),0);
  }finally{await f.close();}
});

test('legacy fallback remains available for programs not requesting multiplex',async()=>{
  const f=await fixture();
  try{
    assert.equal((await request(f)).status,200);
    assert.equal(f.relay.usage().sessions,1);
  }finally{await f.close();}
});
