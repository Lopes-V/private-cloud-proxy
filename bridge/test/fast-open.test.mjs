import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { sealFastOpen, openFastOpen } from '../fast-open.mjs';
import { fixture, request, SECRET } from './fixtures.mjs';

test('early-target header uses authenticated encryption with fresh nonces', () => {
  const a = sealFastOpen(SECRET, 'example.org', 443);
  const b = sealFastOpen(SECRET, 'example.org', 443);
  assert.notEqual(a, b);
  assert.ok(!a.includes('example.org'));
  assert.deepEqual(openFastOpen(SECRET, a), { host:'example.org', port:443 });
  assert.deepEqual(openFastOpen(SECRET, b), { host:'example.org', port:443 });
  assert.throws(() => openFastOpen(SECRET + 'wrong', a));
  const corrupt = Buffer.from(a, 'base64url');
  corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => openFastOpen(SECRET, corrupt.toString('base64url')));
  for (const val of ['', 'not-base64/', 'a'.repeat(751)]) {
    assert.throws(() => openFastOpen(SECRET, val));
  }
  assert.throws(() => sealFastOpen(SECRET, '', 443));
  assert.throws(() => sealFastOpen(SECRET, 'example.org', 65536));
});

test('relay advertises fast-open and handles target before the first browser data frame', async () => {
  const f = await fixture();
  const upgrades = [];
  f.relay.server.on('upgrade', req => upgrades.push(req.headers['x-tunnel-open']));
  try {
    const ready = await f.client.checkRelay();
    assert.equal(ready.processLimit > 0, true);
    const reply = await request(f);
    assert.equal(reply.status, 200);
    assert.equal(reply.body, 'bridge-origin-ok');
    assert.equal(upgrades.length, 1);
    assert.equal(typeof upgrades[0], 'string');
    assert.deepEqual(openFastOpen(SECRET, upgrades[0]), {
      host:'remote-only.invalid', port:f.httpPort
    });
  } finally { await f.close(); }
});

test('legacy handshake works without a readiness capability query', async () => {
  const f = await fixture();
  const upgrades = [];
  f.relay.server.on('upgrade', req => upgrades.push(req.headers['x-tunnel-open']));
  try {
    assert.equal((await request(f)).status, 200);
    assert.deepEqual(upgrades, [undefined]);
  } finally { await f.close(); }
});

test('tampered early target is rejected before allocating relay session or dialing', async () => {
  const f = await fixture();
  let ws;
  try {
    ws = new WebSocket(`wss://localhost:${f.relayPort}/tunnel`, {
      ca:fs.readFileSync(path.join(f.dir,'ca.pem')),
      headers: {Authorization:`Bearer ${SECRET}`, 'X-Tunnel-Open':'forged-header'}
    });
    ws.on('error', () => {});
    const response = once(ws, 'unexpected-response');
    const [,res] = await response;
    assert.equal(res.statusCode, 400);
    res.resume();
    assert.equal(f.relay.usage().sessions, 0);
    assert.equal(f.lookups.length, 0);
  } finally { ws?.terminate(); await f.close(); }
});
