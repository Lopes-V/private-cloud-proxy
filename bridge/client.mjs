import http from 'node:http';
import crypto from 'node:crypto';
import { report, failures } from './diagnostics.mjs';
import https from 'node:https';
import { WebSocket, createWebSocketStream } from 'ws';
import { Budget, meter } from './budget.mjs';
import { target } from './policy.mjs';
import { SessionQueue } from './session-queue.mjs';

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

export function createLocalProxy({ endpoint, secret, ca, budget = new Budget(), ports = new Set([80, 443]),
  proxyEnv = process.env, openTimeoutMs = 15_000, attempts = 12, retryMs = 1000, connectWindowMs = 90_000, maxSessions = 16, maxQueued = 32, queueWaitMs = 60000, diagnostic = event => console.error(JSON.stringify(event)) } = {}) {
  endpoint = validateEndpoint(endpoint);
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Secret must have at least 32 characters');
  const agent = new https.Agent({ proxyEnv, keepAlive: false });
  const queue = new SessionQueue({limit:maxSessions,maxPending:maxQueued,waitMs:queueWaitMs});
  const active = new Set(), pending = new Set(), localSockets = new Set();
  const closing=new WeakSet();
  function endTunnel(ws) {
    if(!ws || ws.readyState===WebSocket.CLOSED || closing.has(ws))return;
    if(ws.readyState!==WebSocket.OPEN && ws.readyState!==WebSocket.CLOSING){ws.terminate();return;}
    closing.add(ws);
    const timer=setTimeout(()=>ws.terminate(),1000);timer.unref();
    ws.once('close',()=>clearTimeout(timer));
    if(ws.readyState===WebSocket.OPEN)ws.close(1000);
  }
  let stopped = false;
  function consume(bytes) {
    try { budget.consume(bytes); } catch {
      report(diagnostic, 'local_traffic', {failure:'TRAFFIC_LIMIT'}, crypto.randomUUID(), performance.now());
      throw Object.assign(new Error('Traffic limit reached'), {failure:'TRAFFIC_LIMIT', retryable:false});
    }
  }
  function onceTunnel(host, port, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
      let ws, settled = false;
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
        ws = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${secret}` }, ca,
          agent, followRedirects: false, rejectUnauthorized: true, minVersion: 'TLSv1.2', handshakeTimeout: timeoutMs, perMessageDeflate: false, maxPayload: 65536 });
      } catch (error) { fail(error); return; }
      pending.add(ws);
      const timer = setTimeout(fail, timeoutMs);
      ws.once('error', fail); ws.once('close', code => fail({ retryable: code !== 1008 }));
      ws.once('unexpected-response', (_req, res) => {
        res.resume(); fail({ failure:res.statusCode === 401 ? 'AUTH_FAILED' : res.statusCode === 429 ? (failures.has(res.headers['x-tunnel-failure']) ? res.headers['x-tunnel-failure'] : 'SESSION_LIMIT') : 'WSS_CONNECTION_FAILED', id:res.headers['x-tunnel-id'], retryable: res.statusCode === 200 || res.statusCode >= 500 || (res.statusCode === 429 && res.headers['x-tunnel-failure'] === 'SESSION_LIMIT') });
      });
      ws.once('open', () => ws.send(JSON.stringify({ host, port })));
      ws.once('message', (message, binary) => {
        try {
          if (binary) throw new Error();
          const verdict=JSON.parse(message.toString());
          if (verdict.ready !== true) { fail({retryable:false,failure:failures.has(verdict.failure)?verdict.failure:'INTERNAL_ERROR',id:verdict.id}); return; }
          settled = true; clearTimeout(timer); pending.delete(ws); active.add(ws);
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
    if(stopped || traffic())throw new Error('Local limit reached');
    let release;const waiting=performance.now();
    try {release=await queue.acquire({signal});}
    catch(error){if(error.failure!=='QUEUE_CANCELLED')report(diagnostic,'local_queue',error,crypto.randomUUID(),waiting);throw error;}
    let handedOff=false;
    try {
      const deadline=Date.now()+connectWindowMs;
      for(let attempt=0;attempt<attempts;attempt++) {
        if(stopped || signal?.aborted || Date.now()>=deadline || traffic())break;
        try {
          const remote=await onceTunnel(host,port,Math.min(openTimeoutMs,deadline-Date.now()),signal);
          remote.ws.once('close',release);
          if(stopped || signal?.aborted || remote.ws.readyState!==WebSocket.OPEN){endTunnel(remote.ws);throw new Error('Cancelled');}
          handedOff=true;return remote;
        }catch(error){
          if(!error.retryable)break;
          if(attempt+1<attempts && !stopped && !signal?.aborted)await new Promise(resolve=>{
            const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};
            const timer=setTimeout(done,Math.max(0,Math.min(retryMs*2**attempt,10000,deadline-Date.now())));
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
        const counted = meter(bytes => consume(bytes + 64));
        counted.on('error', () => { response.destroy(); res.destroy(); endTunnel(remote.ws); });
        response.pipe(counted).pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Tunnel unavailable'); endTunnel(remote.ws); });
      const counted = meter(bytes => consume(bytes + 64));
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
      stream.on('error', finish); stream.on('close', finish); socket.on('error', finish); socket.on('close', () => endTunnel(ws));
      const up = meter(bytes => consume(bytes + 64)), down = meter(bytes => consume(bytes + 64));
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
    async listen(port = 0) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); return server.address().port; },
    async close() {
      stopped=true;queue.close();
      const ending=Promise.all([...active,...pending].map(ws=>new Promise(resolve=>{
        if(ws.readyState===WebSocket.CLOSED)return resolve();
        ws.once('close',resolve);endTunnel(ws);
      })));
      for(const socket of localSockets)socket.destroy();
      await ending;
      if(server.listening)await new Promise(resolve=>server.close(resolve));
      agent.destroy();
    }
  };
}
