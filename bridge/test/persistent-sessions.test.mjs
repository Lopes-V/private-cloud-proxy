import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { DEFAULT_RELAY_TIMEOUTS } from '../server.mjs';
import { fixture } from './fixtures.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function readHeaders(socket) {
  return new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0);
    const timer = setTimeout(() => done(new Error('Proxy response timeout')), 3000);
    function cleanup() {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('close', onClose);
      socket.removeListener('error', done);
    }
    function done(error, data) { cleanup(); if (error) reject(error); else resolve(data); }
    function onClose() { done(new Error('Socket closed before HTTP response')); }
    function onData(chunk) {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length > 8192) return done(new Error('Oversized HTTP headers'));
      if (bytes.includes(Buffer.from('\r\n\r\n'))) done(null, bytes.toString('latin1'));
    }
    socket.on('data', onData);
    socket.once('close', onClose);
    socket.once('error', done);
  });
}

test('default session windows accommodate interactive, persistent HTTPS connections', () => {
  assert.ok(DEFAULT_RELAY_TIMEOUTS.idleMs >= 120_000);
  assert.ok(DEFAULT_RELAY_TIMEOUTS.lifetimeMs >= 1_800_000);
  assert.ok(DEFAULT_RELAY_TIMEOUTS.lifetimeMs > DEFAULT_RELAY_TIMEOUTS.idleMs);
});

test('CONNECT carries an upgraded WebSocket bidirectionally and releases it after genuine inactivity', async () => {
  const originWs = new WebSocketServer({ noServer: true });
  const f = await fixture({
    relayOptions: { idleMs: 230, lifetimeMs: 1800 },
    originUpgrade: (req, socket, head) => originWs.handleUpgrade(req, socket, head, ws => {
      ws.on('message', (data, binary) => ws.send(data, { binary }));
    })
  });
  let socket;
  try {
    socket = net.connect(f.clientPort, '127.0.0.1');
    socket.on('error', () => {});
    await once(socket, 'connect');
    let headers = readHeaders(socket);
    socket.write(`CONNECT localhost:${f.httpPort} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
    assert.match(await headers, /^HTTP\/1\.1 200 Connection Established/);

    headers = readHeaders(socket);
    const key = crypto.randomBytes(16).toString('base64');
    socket.write(`GET /socket HTTP/1.1\r\nHost: localhost:${f.httpPort}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    assert.match(await headers, /^HTTP\/1\.1 101 Switching Protocols/);

    let pongs = 0;
    socket.on('data', chunk => {
      for (let i = 0; i + 1 < chunk.length; i++) {
        if (chunk[i] === 0x8a && chunk[i + 1] === 0) pongs++;
      }
    });
    // Application-originated pings, not proxy heartbeats. Sustained traffic
    // should reset inactivity while the established TLS/WS pipe is usable.
    for (let i = 0; i < 7; i++) {
      socket.write(Buffer.from([0x89, 0x80, 0, 0, 0, 0]));
      await delay(70);
      assert.equal(socket.destroyed, false, 'active socket closed before its lifetime limit');
    }
    assert.ok(pongs >= 5, `Expected WebSocket pong replies; received ${pongs}`);
    const closed = once(socket, 'close');
    await Promise.race([closed, delay(1500).then(() => { throw new Error('Idle socket not closed'); })]);
  } finally {
    socket?.destroy();
    await f.close();
    await new Promise(resolve => originWs.close(resolve));
  }
});
