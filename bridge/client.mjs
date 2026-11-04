import http from 'node:http';
import https from 'node:https';
import { WebSocket, createWebSocketStream } from 'ws';
import { Budget, meter } from './budget.mjs';
import { target } from './policy.mjs';

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
  proxyEnv = process.env, openTimeoutMs = 15_000, attempts = 12, retryMs = 1000, connectWindowMs = 90_000, maxSessions = 8 } = {}) {
  endpoint = validateEndpoint(endpoint);
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Secret must have at least 32 characters');
  const agent = new https.Agent({ proxyEnv, keepAlive: false });
  const active = new Set(), pending = new Set(), localSockets = new Set();
  let stopped = false;
  function onceTunnel(host, port, timeoutMs) {
    return new Promise((resolve, reject) => {
      let ws, settled = false;
      const fail = cause => {
        if (!settled) {
          settled = true; ws?.terminate();
          const error = new Error('Encrypted tunnel unavailable');
          error.retryable = cause?.retryable !== false && !/CERT|TLS|SELF_SIGNED/.test(cause?.code || '');
          reject(error);
        }
      };
      try {
        budget.consume(8192); // Charge every attempt, including failed authentication/TLS.
        ws = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${secret}` }, ca,
          agent, followRedirects: false, rejectUnauthorized: true, minVersion: 'TLSv1.2', handshakeTimeout: timeoutMs, perMessageDeflate: false, maxPayload: 65536 });
      } catch { fail(); return; }
      pending.add(ws);
      const timer = setTimeout(fail, timeoutMs);
      ws.once('error', fail); ws.once('close', code => fail({ retryable: code !== 1008 }));
      ws.once('unexpected-response', (_req, res) => {
        res.resume(); fail({ retryable: res.statusCode === 200 || res.statusCode >= 500 });
      });
      ws.once('open', () => ws.send(JSON.stringify({ host, port })));
      ws.once('message', (message, binary) => {
        try {
          if (binary || JSON.parse(message.toString()).ready !== true) throw new Error();
          settled = true; clearTimeout(timer); pending.delete(ws); active.add(ws);
          const stream = createWebSocketStream(ws, { highWaterMark: 65536 });
          stream.on('error', () => {});
          ws.once('close', () => active.delete(ws));
          resolve({ ws, stream });
        } catch { fail({ retryable: false }); }
      });
      ws.once('close', () => { clearTimeout(timer); pending.delete(ws); active.delete(ws); });
    });
  }
  async function tunnel(host, port, cancelled = () => false) {
    target(host, port, ports);
    if (stopped || active.size + pending.size >= maxSessions || budget.used + 8192 > budget.limit) throw new Error('Local limit reached');
    const deadline = Date.now() + connectWindowMs;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (stopped || cancelled() || Date.now() >= deadline || active.size + pending.size >= maxSessions || budget.used + 8192 > budget.limit) break;
      try { return await onceTunnel(host, port, Math.min(openTimeoutMs, deadline - Date.now())); } catch (error) {
        if (!error.retryable) break;
        if (attempt + 1 < attempts && !stopped && !cancelled()) await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(retryMs * 2 ** attempt, 10_000, deadline - Date.now()))));
      }
    }
    throw new Error('Tunnel unavailable');
  }
  const server = http.createServer(async (req, res) => {
    req.pause();
    let remote;
    try {
      const url = new URL(req.url);
      if (url.protocol !== 'http:' || url.username || url.password) throw new Error();
      remote = await tunnel(url.hostname, Number(url.port || 80), () => res.destroyed);
      if (req.destroyed) { remote.ws.terminate(); return; }
      const headers = removeHopHeaders(req.headers); headers.host = url.host;
      const agent = new http.Agent({ keepAlive: false });
      agent.createConnection = () => remote.stream;
      const upstream = http.request({ method: req.method, path: url.pathname + url.search, headers,
        host: url.hostname, port: Number(url.port || 80), agent }, response => {
        const clean = removeHopHeaders(response.headers);
        res.writeHead(response.statusCode, clean);
        const counted = meter(bytes => budget.consume(bytes + 64));
        counted.on('error', () => { response.destroy(); res.destroy(); remote.ws.terminate(); });
        response.pipe(counted).pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Tunnel unavailable'); remote.ws.terminate(); });
      const counted = meter(bytes => budget.consume(bytes + 64));
      counted.on('error', () => upstream.destroy());
      req.on('aborted', () => upstream.destroy());
      res.on('close', () => { upstream.destroy(); remote.ws.terminate(); });
      req.pipe(counted).pipe(upstream); req.resume();
    } catch {
      remote?.ws.terminate(); res.writeHead(502, { Connection: 'close' }); res.end('Tunnel unavailable');
    }
  });
  server.on('connect', async (req, socket, head) => {
    socket.pause();
    try {
      const { host, port } = parseConnectAuthority(req.url);
      const { ws, stream } = await tunnel(host, port, () => socket.destroyed);
      if (socket.destroyed) { ws.terminate(); return; }
      const finish = () => { socket.destroy(); ws.terminate(); };
      stream.on('error', finish); stream.on('close', finish); socket.on('error', finish); socket.on('close', () => ws.terminate());
      const up = meter(bytes => budget.consume(bytes + 64)), down = meter(bytes => budget.consume(bytes + 64));
      up.on('error', finish); down.on('error', finish);
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) { budget.consume(head.length + 64); stream.write(head); }
      socket.pipe(up).pipe(stream); stream.pipe(down).pipe(socket); socket.resume();
    } catch { socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); }
  });
  server.on('connection', socket => { localSockets.add(socket); socket.on('close', () => localSockets.delete(socket)); socket.on('error', () => {}); });
  server.on('clientError', (_err, socket) => socket.destroy());
  server.headersTimeout = 15_000; server.requestTimeout = 160_000;
  return { server, budget,
    async listen(port = 0) { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); return server.address().port; },
    async close() { stopped = true; for (const ws of [...active, ...pending]) ws.terminate(); for (const s of localSockets) s.destroy(); if (server.listening) await new Promise(resolve => server.close(resolve)); agent.destroy(); }
  };
}
