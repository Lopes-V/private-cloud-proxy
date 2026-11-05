import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { fixture, request } from './fixtures.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connectToOrigin(f) {
  const socket = net.connect(f.clientPort, '127.0.0.1');
  socket.on('error', () => {}); // Connection can be evicted under pressure.
  await once(socket, 'connect');
  const response = once(socket, 'data');
  socket.write(`CONNECT localhost:${f.httpPort} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
  const [firstChunk] = await response;
  assert.match(firstChunk.toString('latin1'), /^HTTP\/1\.1 200 Connection Established/);
  return socket;
}

test('reclaims an old idle tunnel only when a new connection needs the last client slot', async () => {
  const events = [];
  const f = await fixture({
    clientOptions: {
      maxSessions: 1, idleEvictMs: 80, queueWaitMs: 1500,
      diagnostic: event => events.push(event)
    }
  });
  let socket;
  try {
    socket = await connectToOrigin(f);
    assert.equal(f.relay.usage().active, 1);
    await sleep(180);
    assert.equal(socket.destroyed, false, 'idle tunnel must stay open without queue pressure');
    const next = await request(f);
    assert.equal(next.status, 200, 'new request must get the reclaimed local slot');
    assert.ok(events.some(event => event.failure === 'IDLE_EVICTED'));
  } finally {
    socket?.destroy();
    await f.close();
  }
});

test('does not evict a still-fresh tunnel merely because the client queue fills', async () => {
  const events = [];
  const f = await fixture({
    clientOptions: {
      maxSessions: 1, idleEvictMs: 1500, queueWaitMs: 120,
      diagnostic: event => events.push(event)
    }
  });
  let socket;
  try {
    socket = await connectToOrigin(f);
    const next = await request(f);
    assert.equal(next.status, 502, 'fresh established connection must not be sacrificed');
    assert.equal(socket.destroyed, false);
    assert.ok(!events.some(event => event.failure === 'IDLE_EVICTED'));
    assert.ok(events.some(event => event.failure === 'QUEUE_TIMEOUT'));
  } finally {
    socket?.destroy();
    await f.close();
  }
});

test('ongoing request-body activity prevents eviction of active CONNECT stream', async () => {
  const events = [];
  const f = await fixture({
    clientOptions: {
      maxSessions: 1, idleEvictMs: 180, queueWaitMs: 150,
      diagnostic: event => events.push(event)
    }
  });
  let socket;
  try {
    socket = await connectToOrigin(f);
    socket.write(`POST /pending HTTP/1.1\r\nHost: localhost\r\nContent-Length: 4096\r\n\r\n`);
    for (let i = 0; i < 6; i++) {
      socket.write(Buffer.alloc(64, 0x58));
      await sleep(55);
    }
    const next = await request(f);
    assert.equal(next.status, 502);
    assert.equal(socket.destroyed, false);
    assert.ok(!events.some(event => event.failure === 'IDLE_EVICTED'));
  } finally {
    socket?.destroy();
    await f.close();
  }
});
