import http from 'node:http';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { report, failures } from './diagnostics.mjs';
import https from 'node:https';
import { WebSocket, createWebSocketStream } from 'ws';
import { Budget, meter } from './budget.mjs';
import { target } from './policy.mjs';
import { SessionQueue } from './session-queue.mjs';
import { sealFastOpen } from './fast-open.mjs';
import { MuxPeer } from './multiplex.mjs';

export function validateEndpoint(endpoint) {
  const url = new URL(endpoint);
  if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash || url.pathname !== '/tunnel') throw new Error('Use wss://HOST/tunnel, without credentials');
  return url.href;
}

export function parseConnectAuthority(authority) {
  const url = new URL(`http://${authority}`);
  const explicitPort = authority.match(/:(\d+)$/)?.[1];
  if (url.username || url.password || url.pathname !== '/' || !explicitPort || url.search || url.hash) throw new Error('Invalid CONNECT authority');
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(explicitPort) };
}

function removeHopHeaders(headers) {
  const result = { ...headers };
  const named = String(result.connection || '').split(',').map(x => x.trim().toLowerCase());
  for (const name of [...named, 'proxy-authorization', 'proxy-connection', 'connection', 'keep-alive', 'upgrade', 'te', 'trailer', 'transfer-encoding']) delete result[name];
  result.connection = 'close';
  return result;
}

// All retries stay within the active browser request deadline. A temporary remote
// session ceiling is not a reason to wait through exponential-second backoff.
export function retryDelayMs(failure, attempt, retryMs, remainingMs, random = Math.random) {
  if (remainingMs <= 0) return 0;
  const delay = failure === 'SESSION_LIMIT'
    ? 75 + Math.floor(Math.max(0, Math.min(0.999999, random())) * 125)
    : Math.min(retryMs * 2 ** attempt, 10_000);
  return Math.min(delay, remainingMs);
}

export function createLocalProxy({ endpoint, secret, ca, budget = new Budget(), ports = new Set([80, 443]),
  proxyEnv = process.env, openTimeoutMs = 10_000, attempts = 12, retryMs = 1000, connectWindowMs = 90_000, maxSessions = 12, maxQueued = 32, queueWaitMs = 20_000,
  idleEvictMs = 90_000, useMultiplex = false, diagnostic = event => console.error(JSON.stringify(event)) } = {}) {
  endpoint = validateEndpoint(endpoint);
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Secret must have at least 32 characters');
  // Reuse authenticated HTTPS control sockets for readiness and cancellation.
  const agent = new https.Agent({ proxyEnv, keepAlive: true, maxSockets: 32, maxFreeSockets: 4 });
  if (!Number.isFinite(idleEvictMs) || idleEvictMs < 0) throw new Error('Invalid idle eviction threshold');
  const queue = new SessionQueue({limit:maxSessions,maxPending:maxQueued,waitMs:queueWaitMs});
  // HTTPS prevents classifying keep-alive, HTTP/2, and application WebSockets.
  // Never evict normally. Under admission pressure only, preempt the oldest
  // tunnel that has carried no traffic for the conservative grace period.
  const activity = new Map();
  const touch = ws => { const entry = activity.get(ws); if (entry) entry.lastDataAt = performance.now(); };
  function evictIdleUnderPressure() {
    if (idleEvictMs === 0 || queue.stats().active < maxSessions) return false;
    const now = performance.now();
    let victim;
    for (const [ws, state] of activity) {
      if (ws.readyState !== WebSocket.OPEN || closing.has(ws) ||
          now - state.lastDataAt < idleEvictMs) continue;
      if (!victim || state.lastDataAt < victim.state.lastDataAt) victim = { ws, state };
    }
    if (!victim) return false;
    report(diagnostic, 'local_eviction', { failure:'IDLE_EVICTED' },
      crypto.randomUUID(), victim.state.lastDataAt);
    void endTunnel(victim.ws);
    return true;
  }
  const active = new Set(), pending = new Set(), localSockets = new Set();
  const closing=new WeakMap(),sessionIds=new WeakMap(),cancellations=new Set();
  let muxPeer=null,muxConnecting=null,remoteMultiplex=false;
  async function connectMux(timeoutMs=10_000) {
    if(stopped)throw Object.assign(new Error('Proxy stopped'),{retryable:false});
    if(muxPeer && !muxPeer.closed)return muxPeer;
    if(muxConnecting)return muxConnecting;
    const promise = new Promise((resolve,reject)=>{
      const url=new URL(endpoint);url.pathname='/multiplex';
      let ws,settled=false;
      const done=(error,value)=>{
        if(settled)return;settled=true;clearTimeout(timer);
        if(error)reject(error);else resolve(value);
      };
      const timer=setTimeout(()=>{
        ws?.terminate();
        done(Object.assign(new Error('Multiplex connection timeout'),{failure:'WSS_CONNECTION_FAILED',retryable:true}));
      },timeoutMs);
      try {
        ws=new WebSocket(url.href,{headers:{Authorization:'Bearer '+secret},agent,ca,
          followRedirects:false,rejectUnauthorized:true,minVersion:'TLSv1.2',
          handshakeTimeout:timeoutMs,perMessageDeflate:false,maxPayload:32768});
      } catch(error){done(error);return;}
      ws.on('error',()=>done(Object.assign(new Error('Multiplex connection failed'),{
        failure:'WSS_CONNECTION_FAILED',retryable:true
      })));
      ws.once('unexpected-response',(_request,res)=>{
        const status=res.statusCode;
        res.resume();
        if(status===404)remoteMultiplex=false; // Server rolled back: use legacy path.
        done(Object.assign(new Error('Multiplex unavailable'),{
          failure:status===401?'AUTH_FAILED':'WSS_CONNECTION_FAILED',
          retryable:status>=500,unsupported:status===404
        }));
        ws.terminate();
      });
      ws.once('open',()=>{
        const peer=new MuxPeer(ws,{role:'client',maxChannels:maxSessions});
        muxPeer=peer;
        ws.once('close',()=>{if(muxPeer===peer)muxPeer=null;});
        done(null,peer);
      });
      ws.once('close',()=>done(Object.assign(new Error('Multiplex connection closed'),{
        failure:'WSS_CONNECTION_FAILED',retryable:true
      })));
    });
    muxConnecting=promise;
    try{return await promise;}
    finally{if(muxConnecting===promise)muxConnecting=null;}
  }
  async function multiplexTunnel(host,port,timeoutMs,signal){
    if(signal?.aborted)throw Object.assign(new Error('Cancelled'),{retryable:false});
    let peer;
    try { peer=await connectMux(timeoutMs); }
    catch(error) {
      // Version-rollback compatibility only. Authentication and network errors
      // never cause a switch to a direct or unauthenticated transport.
      if(error.unsupported && !remoteMultiplex) return onceTunnel(host,port,timeoutMs,signal);
      throw error;
    }
    consume(8192); // Reserve per logical session, including attempts.
    const stream=await peer.open(host,port,{timeoutMs,signal});
    const virtual=new EventEmitter();
    virtual.isMux=true;virtual.readyState=WebSocket.OPEN;
    virtual.close=()=>stream.destroy();
    virtual.terminate=()=>stream.destroy();
    stream.once('close',()=>{
      virtual.readyState=WebSocket.CLOSED;
      virtual.emit('close',1000);
      active.delete(virtual);
    });
    active.add(virtual);
    return {ws:virtual,stream};
  }
  function cancelSession(ws) {
    const id=sessionIds.get(ws);
    if(!id)return Promise.resolve();
    const cancellation=new Promise(resolve=>{
      let request,finished=false;
      const done=(error)=>{if(finished)return;finished=true;clearTimeout(timer);if(error)request?.destroy();resolve();};
      const timer=setTimeout(()=>done(new Error('Cancellation deadline')),2000);
      try{
        const url=new URL(endpoint);url.protocol='https:';url.pathname='/tunnel/'+id;
        request=https.request(url,{method:'DELETE',agent,ca,rejectUnauthorized:true,minVersion:'TLSv1.2',headers:{Authorization:'Bearer '+secret}},res=>{
          // Normal 204 replies can reuse the authenticated HTTPS connection.
          // A malformed/never-ending response remains bounded by the deadline.
          let size=0;
          res.on('data',chunk=>{size+=chunk.length;if(size>1024)done(new Error('Oversized cancellation response'));});
          res.once('end',done);
          res.once('error',done);
          res.resume();
        });
        request.once('error',done);request.end();
      }catch{done();}
    });
    cancellations.add(cancellation);cancellation.then(()=>cancellations.delete(cancellation));return cancellation;
  }
  function endTunnel(ws) {
    if(!ws)return Promise.resolve();
    if(ws.isMux) {
      if(closing.has(ws))return closing.get(ws);
      const result=Promise.resolve();closing.set(ws,result);
      ws.close();return result;
    }
    if(closing.has(ws))return closing.get(ws);
    const cancellation=cancelSession(ws);closing.set(ws,cancellation);
    if(ws.readyState===WebSocket.CLOSED)return cancellation;
    if(ws.readyState!==WebSocket.OPEN && ws.readyState!==WebSocket.CLOSING){ws.terminate();return cancellation;}
    const timer=setTimeout(()=>ws.terminate(),1000);timer.unref();
    ws.once('close',()=>clearTimeout(timer));
    if(ws.readyState===WebSocket.OPEN)ws.close(1000);
    return cancellation;
  }
  let stopped = false,remoteQuotaExhausted=false,remoteFastOpen=false;
  const probes=new Set();
  function consume(bytes) {
    try { budget.consume(bytes); } catch {
      report(diagnostic, 'local_traffic', {failure:'TRAFFIC_LIMIT'}, crypto.randomUUID(), performance.now());
      throw Object.assign(new Error('Traffic limit reached'), {failure:'TRAFFIC_LIMIT',source:'local',retryable:false});
    }
  }
  async function checkRelay({timeoutMs=90000}={}) {
    if(stopped || !Number.isFinite(timeoutMs) || timeoutMs<=0 || timeoutMs>90000)throw new Error('Invalid readiness state');
    consume(8192);
    return new Promise((resolve,reject)=>{
      let request,finished=false;const started=performance.now();
      const done=(error,value)=>{
        if(finished)return;finished=true;clearTimeout(timer);probes.delete(request);if(error)request?.destroy();
        if(error)reject(Object.assign(new Error('Relay unavailable'),{failure:error.failure||'WSS_CONNECTION_FAILED',code:error.code,source:error.source}));
        else resolve(value);
      };
      const timer=setTimeout(()=>done({code:'ETIMEDOUT'}),timeoutMs);
      try{
        const url=new URL(endpoint);url.protocol='https:';url.pathname='/usage';
        request=https.get(url,{agent,ca,rejectUnauthorized:true,minVersion:'TLSv1.2',headers:{Authorization:'Bearer '+secret}},res=>{
          if(res.statusCode!==200){res.resume();done({failure:res.statusCode===401?'AUTH_FAILED':'WSS_CONNECTION_FAILED'});return;}
          let body='',bytes=0;
          res.on('data',chunk=>{
            if(finished)return;
            try{consume(chunk.length+64);bytes+=chunk.length;if(bytes>16384)throw new Error('Response limit');body+=chunk;}
            catch(error){done(error);}
          });
          res.once('error',error=>done(error));
          res.once('end',()=>{
            if(finished)return;
            try{
              const usage=JSON.parse(body);
              if(!['active','sessions','bytes','processLimit'].every(key=>Number.isSafeInteger(usage[key])&&usage[key]>=0) || usage.processLimit<1 || usage.bytes>usage.processLimit)throw new Error('Invalid usage');
              if(usage.processLimit-usage.bytes<8192){remoteQuotaExhausted=true;done({failure:'TRAFFIC_LIMIT',source:'remote'});return;}
              remoteQuotaExhausted=false;
              remoteFastOpen=usage.fastOpen===true;
              remoteMultiplex=useMultiplex && usage.multiplex===true;
              done(null,{active:usage.active,sessions:usage.sessions,bytes:usage.bytes,processLimit:usage.processLimit,readyMs:Math.round(performance.now()-started)});
            }catch(error){done(error);}
          });
        });
        probes.add(request);request.once('error',error=>done(error));
      }catch(error){done(error);}
    });
  }
  function onceTunnel(host, port, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
      let ws, settled = false;
      const earlyTarget = remoteFastOpen;
      const id=crypto.randomUUID(), started=performance.now();
      const fail = cause => {
        if (!settled) {
          settled = true; ws?.terminate();
          const event = cause?.failure === 'QUEUE_CANCELLED' ? {failure:'QUEUE_CANCELLED',id} : report(diagnostic, 'wss', cause, /^[a-f0-9-]{36}$/.test(cause?.id || '') ? cause.id : id, started);
          const error = new Error('Encrypted tunnel unavailable');
          error.failure=event.failure;error.id=event.id;
          error.retryable = cause?.retryable !== false && !/CERT|TLS|SELF_SIGNED/.test(cause?.code || '');
          reject(error);
        }
      };
      try {
        if(signal?.aborted)throw Object.assign(new Error('Cancelled'),{failure:'QUEUE_CANCELLED',retryable:false});
        consume(8192); // Charge every attempt, including failed authentication/TLS.
        const headers = { Authorization: `Bearer ${secret}` };
        if (earlyTarget) headers['X-Tunnel-Open'] = sealFastOpen(secret, host, port);
        ws = new WebSocket(endpoint, { headers, ca,
          agent, followRedirects: false, rejectUnauthorized: true, minVersion: 'TLSv1.2', handshakeTimeout: timeoutMs, perMessageDeflate: false, maxPayload: 65536 });
      } catch (error) { fail(error); return; }
      pending.add(ws);
      const timer = setTimeout(fail, timeoutMs);
      ws.once('error', fail); ws.once('close', code => fail({ retryable: code !== 1008 }));
      ws.once('unexpected-response', (_req, res) => {
        res.resume();if(res.statusCode===429 && res.headers['x-tunnel-failure']==='TRAFFIC_LIMIT')remoteQuotaExhausted=true; fail({ failure:res.statusCode === 401 ? 'AUTH_FAILED' : res.statusCode === 429 ? (failures.has(res.headers['x-tunnel-failure']) ? res.headers['x-tunnel-failure'] : 'SESSION_LIMIT') : 'WSS_CONNECTION_FAILED', id:res.headers['x-tunnel-id'], retryable: res.statusCode === 200 || res.statusCode >= 500 || (res.statusCode === 429 && res.headers['x-tunnel-failure'] === 'SESSION_LIMIT') });
      });
      ws.once('open', () => { if (!earlyTarget) ws.send(JSON.stringify({ host, port })); });
      ws.once('message', (message, binary) => {
        try {
          if (binary) throw new Error();
          const verdict=JSON.parse(message.toString());
          if (verdict.ready !== true) { fail({retryable:false,failure:failures.has(verdict.failure)?verdict.failure:'INTERNAL_ERROR',id:verdict.id}); return; }
          settled = true; clearTimeout(timer); pending.delete(ws); active.add(ws);
          if(/^[a-f0-9-]{36}$/.test(verdict.id||''))sessionIds.set(ws,verdict.id);
          const stream = createWebSocketStream(ws, { highWaterMark: 65536 });
          stream.on('error', () => {});
          ws.once('close', code => {active.delete(ws);if(!signal?.aborted && code!==1000 && code!==1005)report(diagnostic,'connected',{failure:'REMOTE_SOCKET_CLOSED'},/^[a-f0-9-]{36}$/.test(verdict.id||'')?verdict.id:id,started);});
          resolve({ ws, stream });
        } catch { fail({ retryable: false }); }
      });
      const abort = () => { if(settled){endTunnel(ws);return;}ws.terminate();fail({failure:'QUEUE_CANCELLED',retryable:false}); };
      signal?.addEventListener('abort',abort,{once:true});
      ws.once('close', () => { clearTimeout(timer); signal?.removeEventListener('abort',abort); pending.delete(ws); active.delete(ws); });
    });
  }
  async function tunnel(host, port, signal) {
    target(host, port, ports);
    const traffic = () => {
      if(budget.used + 8192 <= budget.limit)return false;
      report(diagnostic,'local_limit',{failure:'TRAFFIC_LIMIT'},crypto.randomUUID(),performance.now());return true;
    };
    if(stopped || remoteQuotaExhausted || traffic())throw new Error('Traffic unavailable');
    let release;const waiting=performance.now();
    try {evictIdleUnderPressure();release=await queue.acquire({signal});}
    catch(error){if(error.failure!=='QUEUE_CANCELLED')report(diagnostic,'local_queue',error,crypto.randomUUID(),waiting);throw error;}
    let handedOff=false;
    try {
      const deadline=Date.now()+connectWindowMs;
      for(let attempt=0;attempt<attempts;attempt++) {
        if(stopped || remoteQuotaExhausted || signal?.aborted || Date.now()>=deadline || traffic())break;
        try {
          const remaining=Math.min(openTimeoutMs,deadline-Date.now());
          const remote=remoteMultiplex ? await multiplexTunnel(host,port,remaining,signal) :
            await onceTunnel(host,port,remaining,signal);
          // A closed local WebSocket no longer occupies the client's admission slot.
          // Remote cleanup is best-effort and independent, with eight spare
          // relay slots and bounded retries for transient SESSION_LIMIT.
          // Remove tracking and grant the next queued request as soon as the
          // local WSS closes. The remote DELETE still runs independently.
          activity.set(remote.ws, { lastDataAt: performance.now() });
          remote.ws.once('close', () => { activity.delete(remote.ws); release(); });
          if(stopped || signal?.aborted || remote.ws.readyState!==WebSocket.OPEN){endTunnel(remote.ws);throw new Error('Cancelled');}
          handedOff=true;return remote;
        }catch(error){
          if(!error.retryable)break;
          if(attempt+1<attempts && !stopped && !signal?.aborted)await new Promise(resolve=>{
            const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};
            const timer=setTimeout(done,retryDelayMs(error.failure,attempt,retryMs,deadline-Date.now()));
            signal?.addEventListener('abort',done,{once:true});if(signal?.aborted)done();
          });
        }
      }
      throw new Error('Tunnel unavailable');
    } finally {if(!handedOff)release();}
  }
  const server = http.createServer(async (req, res) => {
    req.pause();
    const controller=new AbortController();
    req.once('aborted',()=>controller.abort());res.once('close',()=>controller.abort());
    let remote;
    try {
      const url = new URL(req.url);
      if (url.protocol !== 'http:' || url.username || url.password) throw new Error();
      remote = await tunnel(url.hostname, Number(url.port || 80), controller.signal);
      if (req.destroyed) { endTunnel(remote.ws); return; }
      const headers = removeHopHeaders(req.headers); headers.host = url.host;
      const agent = new http.Agent({ keepAlive: false });
      agent.createConnection = () => remote.stream;
      const upstream = http.request({ method: req.method, path: url.pathname + url.search, headers,
        host: url.hostname, port: Number(url.port || 80), agent }, response => {
        const clean = removeHopHeaders(response.headers);
        res.writeHead(response.statusCode, clean);
        const counted = meter(bytes => consume(bytes + 64), () => touch(remote.ws));
        counted.on('error', () => { response.destroy(); res.destroy(); endTunnel(remote.ws); });
        response.pipe(counted).pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Tunnel unavailable'); endTunnel(remote.ws); });
      const counted = meter(bytes => consume(bytes + 64), () => touch(remote.ws));
      counted.on('error', () => upstream.destroy());
      req.on('aborted', () => upstream.destroy());
      res.on('close', () => { upstream.destroy(); endTunnel(remote.ws); });
      req.pipe(counted).pipe(upstream); req.resume();
    } catch {
      endTunnel(remote?.ws); if(res.destroyed)return; res.writeHead(502, { Connection: 'close' }); res.end('Tunnel unavailable');
    }
  });
  server.on('connect', async (req, socket, head) => {
    socket.pause();
    const controller=new AbortController();socket.once('close',()=>controller.abort());
    let remote, established = false;
    try {
      const { host, port } = parseConnectAuthority(req.url);
      remote = await tunnel(host, port, controller.signal);
      const { ws, stream } = remote;
      if (socket.destroyed) { endTunnel(ws); return; }
      const finish = () => { socket.destroy(); endTunnel(ws); };
      stream.on('error', finish); stream.on('close', finish); socket.on('error', finish);socket.on('end',()=>endTunnel(ws)); socket.on('close', () => endTunnel(ws));
      const up = meter(bytes => consume(bytes + 64), () => touch(ws)), down = meter(bytes => consume(bytes + 64), () => touch(ws));
      up.on('error', finish); down.on('error', finish);
      if (head.length) consume(head.length + 64);
      established = true;
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) stream.write(head);
      socket.pipe(up).pipe(stream); stream.pipe(down).pipe(socket); socket.resume();
    } catch {
      endTunnel(remote?.ws);
      if(socket.destroyed)return;
      if (established) socket.destroy();
      else socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    }
  });
  server.on('connection', socket => { localSockets.add(socket); socket.on('close', () => localSockets.delete(socket)); socket.on('error', () => {}); });
  server.on('clientError', (_err, socket) => socket.destroy());
  server.headersTimeout = 15_000; server.requestTimeout = 160_000;
  return { server, budget,
    checkRelay,
    async primeTransport() {
      if(!remoteMultiplex)return false;
      try { await connectMux(openTimeoutMs); return true; }
      catch(error) { if(error.unsupported && !remoteMultiplex)return false; throw error; }
    },
    async listen(port = 0) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); return server.address().port; },
    async close() {
      stopped=true;queue.close();activity.clear();for(const probe of probes)probe.destroy();
      const ending=Promise.all([...active,...pending].map(ws=>new Promise(resolve=>{
        if(ws.readyState===WebSocket.CLOSED)return resolve();
        ws.once('close',resolve);endTunnel(ws);
      })));
      for(const socket of localSockets)socket.destroy();
      await ending;await Promise.all([...cancellations]);
      if(server.listening)await new Promise(resolve=>server.close(resolve));
      muxPeer?.close();agent.destroy();
    }
  };
}
