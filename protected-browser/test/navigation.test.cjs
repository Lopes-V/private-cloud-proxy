'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAddress, proxyPort } = require('../navigation.cjs');

test('normalizes HTTPS pages and preserves URL paths', () => {
  assert.equal(normalizeAddress('example.org'), 'https://example.org/');
  assert.equal(normalizeAddress('  https://web.whatsapp.com/  '), 'https://web.whatsapp.com/');
  assert.equal(normalizeAddress('http://example.com/path?q=1'), 'http://example.com/path?q=1');
});
test('rejects active-content schemes and embedded credentials', () => {
  for (const value of ['javascript:alert(1)', 'file:///C:/secret', 'data:text/html,test',
    'ftp://example.org', 'https://user:pass@example.org', '  ', 'a'.repeat(2100)]) {
    assert.throws(() => normalizeAddress(value));
  }
});
test('requires a valid local proxy port', () => {
  assert.equal(proxyPort('17831'), 17831);
  for (const input of ['0', '80', '65536', 'hello', '1.5']) assert.throws(() => proxyPort(input));
});
