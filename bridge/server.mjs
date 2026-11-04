import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket, createWebSocketStream } from 'ws';
import { resolvePublic, target } from './policy.mjs';
import { Budget, meter } from './budget.mjs';

export function createRelay({ secret, server = http.createServer(), resolve = resolvePublic,
  ports = new Set([80, 443]), maxSessions = 8, maxBytes = 8 * 1024 * 1024,
  processBytes = 64 * 1024 * 1024, idleMs = 45_000, lifetimeMs = 300_000,
  connectMs = 10_000, dailySessions = 2000 } = {}) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('TUNNEL_TOKEN must have at least 32 characters');
  const expected = Buffer.from(`Bearer ${secret}`);
  const budget = new Budget({ limit: processBytes });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  const connections = new Set();
  let day = '', count = 0;
  server.requestTimeout = 10_000; server.headersTimeout = 10_000;
  function authorized(req) {
    const actual = Buffer.from(req.headers.authorization || '');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  server.on('request', (req, res) => {
    if (req.url === '/usage' && req.method === 'GET') {
      if (!authorized(req)) { res.writeHead(401, { 'Cache-Control': 'no-store' }); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ active: connections.size, sessions: count, day, bytes: budget.used, processLimit: budget.limit })); return;
    }
    res.writeHead(req.method === 'GET' && req.url === '/health' ? 200 : 404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end(req.url === '/health' ? 'ok' : 'not found');
  });
  function reject(socket, status) { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); }
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/tunnel' || req.headers.origin || !authorized(req)) return reject(socket, '401 Unauthorized');
    const today = new Date().toISOString().slice(0, 10);
    if (day !== today) { day = today; count = 0; }
    if (connections.size >= maxSessions || count >= dailySessions || budget.used >= budget.limit) return reject(socket, '429 Too Many Requests');
    wss.handleUpgrade(req, socket, head, ws => {
      connections.add(ws); count++;
      let upstream, stream, idle, total = 0, finished = false;
      const timers = [];
      const finish = () => {
        if (finished) return; finished = true;
        clearTimeout(idle); timers.forEach(clearTimeout);
        upstream?.destroy(); stream?.destroy(); ws.terminate(); connections.delete(ws);
      };
      const activity = () => { clearTimeout(idle); idle = setTimeout(finish, idleMs); idle.unref(); };
      ws.on('error', finish); ws.on('close', finish);
      timers.push(setTimeout(finish, connectMs), setTimeout(finish, lifetimeMs));
      ws.once('message', async (message, binary) => {
        try {
          if (binary || message.length > 1024) throw new Error('Invalid opening');
          const { host, port } = JSON.parse(message.toString());
          target(host, port, ports);
          const address = await resolve(host);
          if (finished || ws.readyState !== WebSocket.OPEN || !net.isIP(address)) return finish();
          // No hostname reaches net.connect: DNS cannot be rebound between check and dial.
          upstream = net.createConnection({ host: address, port, family: net.isIP(address) });
          upstream.once('error', finish);
          upstream.once('connect', () => {
            if (finished) return;
            clearTimeout(timers[0]);
            ws.send(JSON.stringify({ ready: true }));
            stream = createWebSocketStream(ws, { highWaterMark: 65536 });
            const consume = bytes => {
              if ((total += bytes) > maxBytes) throw new Error('Session limit');
              budget.consume(bytes);
            };
            const outbound = meter(consume, activity), inbound = meter(consume, activity);
            for (const component of [stream, outbound, inbound]) component.on('error', finish);
            upstream.pipe(outbound).pipe(stream);
            stream.pipe(inbound).pipe(upstream);
            activity();
          });
        } catch {
          if (ws.readyState === WebSocket.OPEN) {
            // Some intermediaries delay control-close propagation. Send a verdict
            // as application data so a denied request fails promptly everywhere.
            ws.send(JSON.stringify({ ready: false }), error => {
              if (error) finish(); else ws.close(1008, 'Unavailable');
            });
          } else finish();
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
