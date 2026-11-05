import http from 'node:http';
import { connectPinned } from './connect.mjs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket, createWebSocketStream } from 'ws';
import { resolvePublicAddresses, target } from './policy.mjs';
import { Budget, meter } from './budget.mjs';
import { report as emit } from './diagnostics.mjs';

export function createRelay({ secret, server = http.createServer(), resolve = resolvePublicAddresses, connect = connectPinned,
  ports = new Set([80, 443]), maxSessions = 16, maxBytes = 16 * 1024 * 1024,
  processBytes = 64 * 1024 * 1024, idleMs = 45_000, lifetimeMs = 300_000,
  connectMs = 10_000, dailySessions = 2000, diagnostic = event => console.error(JSON.stringify(event)) } = {}) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('TUNNEL_TOKEN must have at least 32 characters');
  const expected = Buffer.from(`Bearer ${secret}`);
  const budget = new Budget({ limit: processBytes });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  const connections = new Set();
  const history=[];
  const record=event=>{history.push(event);if(history.length>64)history.shift();try{diagnostic(event);}catch{}};
  let day = '', count = 0;
  server.requestTimeout = 10_000; server.headersTimeout = 10_000;
  function authorized(req) {
    const actual = Buffer.from(req.headers.authorization || '');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  server.on('request', (req, res) => {
    if (req.url === '/diagnostics' && req.method === 'GET') {
      if (!authorized(req)) { res.writeHead(401,{'Cache-Control':'no-store'});res.end();return; }
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({events:history}));return;
    }
    if (req.url === '/usage' && req.method === 'GET') {
      if (!authorized(req)) { res.writeHead(401, { 'Cache-Control': 'no-store' }); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ active: connections.size, sessions: count, day, bytes: budget.used, processLimit: budget.limit })); return;
    }
    if (req.url === '/health' && /^[a-f0-9]{40}$/.test(process.env.RENDER_GIT_COMMIT || '')) res.setHeader('X-Relay-Revision', process.env.RENDER_GIT_COMMIT);
    res.writeHead(req.method === 'GET' && req.url === '/health' ? 200 : 404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end(req.url === '/health' ? 'ok' : 'not found');
  });
  function reject(socket, status, failure, id) { socket.end(`HTTP/1.1 ${status}\r\n${failure ? `X-Tunnel-Failure: ${failure}\r\n` : ''}${id ? `X-Tunnel-Id: ${id}\r\n` : ''}Connection: close\r\nContent-Length: 0\r\n\r\n`); }
  server.on('upgrade', (req, socket, head) => {
    const id = crypto.randomUUID(), started = performance.now();
    const report = (stage, error) => emit(record, stage, error, id, started);
    if (req.url !== '/tunnel' || req.headers.origin || !authorized(req)) { report('wss', {failure:'AUTH_FAILED'}); return reject(socket, '401 Unauthorized'); }
    const today = new Date().toISOString().slice(0, 10);
    if (day !== today) { day = today; count = 0; }
    if (connections.size >= maxSessions || count >= dailySessions || budget.used >= budget.limit) { const event=report('limit', {failure:budget.used >= budget.limit ? 'TRAFFIC_LIMIT' : count >= dailySessions ? 'SESSION_QUOTA' : 'SESSION_LIMIT'}); return reject(socket, '429 Too Many Requests', event.failure, event.id); }
    wss.handleUpgrade(req, socket, head, ws => {
      connections.add(ws); count++;
      let upstream, stream, idle, total = 0, finished = false, denied = false;
      const timers = [];
      const finish = () => {
        if (finished) return; finished = true;
        clearTimeout(idle); timers.forEach(clearTimeout);
        upstream?.destroy(); stream?.destroy(); ws.terminate(); connections.delete(ws);
      };
      const deny = event => {
        if (finished || denied) return;
        denied = true; upstream?.destroy();
        clearTimeout(timers[0]);
        timers.push(setTimeout(finish, 1000));
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ ready: false, failure: event.failure, id: event.id }), error => {
            if (error) finish(); else ws.close(1008, 'Unavailable');
          });
        } else finish();
      };
      const activity = () => { clearTimeout(idle); idle = setTimeout(finish, idleMs); idle.unref(); };
      ws.on('error', finish); ws.on('close', finish);
      let stage = 'opening';
      timers.push(setTimeout(() => { deny(report(stage === 'dns' ? 'dns_timeout' : stage === 'tcp' ? 'tcp_timeout' : 'opening_timeout', {code:'ETIMEDOUT'})); }, connectMs), setTimeout(finish, lifetimeMs));
      ws.once('message', async (message, binary) => {
        try {
          if (binary || message.length > 1024) throw new Error('Invalid opening');
          const { host, port } = JSON.parse(message.toString());
          stage = 'policy';
          target(host, port, ports);
          stage = 'dns';
          const resolved = await resolve(host);
          if (finished || denied) return;
          if (ws.readyState !== WebSocket.OPEN) return finish();
          const addresses = Array.isArray(resolved) ? resolved : [resolved];
          // Only the validated snapshot reaches the socket's custom lookup.
          stage = 'tcp';
          upstream = connect(addresses, port);
          upstream.on('connectionAttemptFailed', (_address, _port, _family, error) => report('tcp', error));
          upstream.on('connectionAttemptTimeout', () => report('tcp_timeout', {code:'ETIMEDOUT'}));
          upstream.once('error', error => { const event=report(stage, error.errors?.at(-1) || error); if (stage === 'tcp') deny(event); else finish(); });
          upstream.once('connect', () => {
            if (finished || denied) return;
            clearTimeout(timers[0]);
            stage = 'connected';
            ws.send(JSON.stringify({ ready: true, id }));
            stream = createWebSocketStream(ws, { highWaterMark: 65536 });
            const consume = bytes => {
              try {
                if ((total += bytes) > maxBytes) throw new Error('Session limit');
                budget.consume(bytes);
              } catch (error) { report('traffic', {failure:'TRAFFIC_LIMIT'}); throw error; }
            };
            const outbound = meter(consume, activity), inbound = meter(consume, activity);
            for (const component of [stream, outbound, inbound]) component.on('error', finish);
            upstream.pipe(outbound).pipe(stream);
            stream.pipe(inbound).pipe(upstream);
            activity();
          });
        } catch (error) {
          deny(report(stage, error));
        }
      });
    });
  });
  server.on('clientError', (_err, socket) => socket.destroy());
  return {
    server, usage: () => ({ active: connections.size, sessions: count, bytes: budget.used }),
    async close() {
      for (const ws of connections) ws.terminate();
      await new Promise(resolve => wss.close(resolve));
      server.closeAllConnections();
      if (server.listening) await new Promise(resolve => server.close(resolve));
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const relay = createRelay({ secret: process.env.TUNNEL_TOKEN });
    const port = Number(process.env.PORT || 10000);
    relay.server.listen(port, '0.0.0.0', () => console.log('Private relay ready'));
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { relay.close().then(() => process.exit(0)); });
  } catch { console.error('Missing or invalid server configuration'); process.exit(1); }
}
