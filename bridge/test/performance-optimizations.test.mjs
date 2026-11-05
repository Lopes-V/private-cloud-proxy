import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCachedPublicResolver } from '../policy.mjs';
import { retryDelayMs } from '../client.mjs';
import { fixture, request } from './fixtures.mjs';

test('retry for a temporary remote session limit stays under 200 ms and honors deadline', () => {
  assert.equal(retryDelayMs('SESSION_LIMIT', 7, 1000, 10_000, () => 0), 75);
  assert.equal(retryDelayMs('SESSION_LIMIT', 7, 1000, 10_000, () => 0.999), 199);
  assert.equal(retryDelayMs('SESSION_LIMIT', 7, 1000, 50, () => 0.999), 50);
  assert.equal(retryDelayMs('SESSION_LIMIT', 7, 1000, 0, () => 0), 0);
  assert.equal(retryDelayMs('WSS_CONNECTION_FAILED', 2, 1000, 10_000), 4000);
  assert.equal(retryDelayMs('WSS_CONNECTION_FAILED', 20, 1000, 900), 900);
});

test('public DNS cache coalesces concurrent lookups, returns copies and expires', async () => {
  let count = 0, time = 0, finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const lookup = createCachedPublicResolver({
    resolve: async () => { count++; await gate; return ['1.1.1.1','2606:4700:4700::1111']; },
    ttlMs: 20_000, maxEntries: 2, now: () => time
  });
  const one = lookup('Example.COM'), two = lookup('example.com');
  finish();
  const a = await one, b = await two;
  assert.equal(count, 1);
  a.push('8.8.8.8');
  assert.deepEqual(b, ['1.1.1.1','2606:4700:4700::1111']);
  assert.deepEqual(await lookup('example.com'), b);
  assert.equal(count, 1);
  time = 20_001;
  assert.deepEqual(await lookup('example.com'), b);
  assert.equal(count, 2);
});

test('public DNS cache cannot preserve private or mixed answers and does not cache denials', async () => {
  let count = 0;
  const lookup = createCachedPublicResolver({
    resolve: async () => {count++; return ['1.1.1.1', '127.0.0.1'];}
  });
  await assert.rejects(lookup('example.com'), { code: 'DNS_REJECTED' });
  await assert.rejects(lookup('example.com'), { code: 'DNS_REJECTED' });
  assert.equal(count, 2);
});

test('DNS cache evicts least-recently-used host within its bounded memory', async () => {
  const names=[];
  const lookup = createCachedPublicResolver({
    resolve: async host => {names.push(host);return ['1.1.1.1'];},
    maxEntries: 2
  });
  await lookup('first.test'); await lookup('second.test'); await lookup('first.test');
  await lookup('third.test'); await lookup('second.test');
  assert.deepEqual(names,['first.test','second.test','third.test','second.test']);
});

test('successful HTTPS readiness controls reuse a TLS connection', async () => {
  const f = await fixture();
  let handshakes = 0;
  f.relay.server.on('secureConnection', () => handshakes++);
  try {
    const a = await f.client.checkRelay();
    await new Promise(resolve => setImmediate(resolve));
    const b = await f.client.checkRelay();
    assert.equal(a.processLimit,b.processLimit);
    assert.equal(handshakes,1,'successful /usage responses should not destroy reusable control sockets');
    assert.equal((await request(f)).status,200);
  } finally { await f.close(); }
});
