import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('public-address and DNS policy exists and rejects forbidden answers', async () => {
  assert.ok(fs.existsSync(new URL('../policy.mjs', import.meta.url)), 'security policy is missing');
  const { isPublic, resolvePublic, target } = await import('../policy.mjs');
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.0.1', '169.254.169.254', '100.100.100.200', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '2002:0808:0808::1']) {
    assert.equal(isPublic(ip), false, ip);
  }
  assert.equal(isPublic('8.8.8.8'), true);
  assert.equal(isPublic('2606:4700:4700::1111'), true);
  assert.throws(() => target('example.com', 22));
  assert.throws(() => target('example.com@evil.example', 443));
  let calls = 0;
  const lookup = async () => (++calls === 1 ? [{ address: '8.8.8.8' }] : [{ address: '127.0.0.1' }]);
  assert.equal(await resolvePublic('dual.example', async () => [{ address: '2606:4700:4700::1111' }, { address: '8.8.8.8' }]), '8.8.8.8');
  assert.equal(await resolvePublic('changing.example', lookup), '8.8.8.8');
  await assert.rejects(resolvePublic('changing.example', lookup));
  await assert.rejects(resolvePublic('mixed.example', async () => [{ address: '8.8.8.8' }, { address: '10.0.0.1' }]));
});
