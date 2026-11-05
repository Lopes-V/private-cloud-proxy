const test = require('node:test')
const assert = require('node:assert/strict')
const { PrivateCloudNetworkManager, PrivateCloudDiagnostics, bridgePort } = require('../network/private-cloud-proxy')

function fixture(port = 17831) {
  const calls = []
  const stored = { mode: 'direct', routing: 'domain', proxyDomains: ['example.com'], passwordEncrypted: 'original-ciphertext' }
  const storage = new Map([['network-config', stored]])
  const session = { setProxy: async config => calls.push(config), closeAllConnections: async () => calls.push('closed'), resolveProxy: async () => 'PROXY 127.0.0.1:' + port }
  return { calls, stored, storage, session, manager: new PrivateCloudNetworkManager({ session, storage, port }) }
}

test('bridge port is bounded and defaults to the existing loopback client', () => {
  assert.equal(bridgePort(), 17831)
  assert.equal(bridgePort('12345'), 12345)
  for (const value of ['', '0', '-1', '65536', '17831x', '1.5', 'DIRECT']) assert.throws(() => bridgePort(value))
})
test('stored direct settings cannot override the private proxy and are preserved', async () => {
  const f = fixture(12345)
  const state = await f.manager.restore()
  assert.deepEqual(f.calls, [{ mode: 'fixed_servers', proxyRules: 'http=127.0.0.1:12345;https=127.0.0.1:12345', proxyBypassRules: '<-loopback>' }, 'closed'])
  assert.equal(state.managed, true)
  assert.equal(state.config.mode, 'http')
  assert.equal(state.config.routing, 'global')
  assert.equal(state.config.hasPassword, false)
  assert.deepEqual(f.storage.get('network-config'), f.stored)
  await f.manager.restore()
  assert.equal(f.calls.length, 2, 'reading/restoring settings must not repeatedly tear down live tabs')
})
test('UI requests cannot change route, inject credentials or enable direct fallback', async () => {
  const f = fixture()
  await f.manager.restore()
  for (const config of [{ mode: 'direct' }, { mode: 'socks5', host: 'other.invalid', port: 1080 }, { mode: 'http', routing: 'domain', proxyDomains: ['example.com'] }, { username: 'user', password: 'do-not-store-this' }]) await assert.rejects(f.manager.apply(config), /gerenciada/i)
  assert.equal(f.calls.length, 2)
  assert.ok(!JSON.stringify(f.manager.getPublicState()).includes('do-not-store-this'))
})
test('proxy setup failure is propagated rather than accepting original direct config', async () => {
  const f = fixture()
  f.session.setProxy = async () => { throw new Error('configuration rejected') }
  await assert.rejects(f.manager.restore(), /configuration rejected/)
  assert.deepEqual(f.calls, [])
})
test('network events keep only origins and fixed errors, separate from browser history', async () => {
  const f = fixture()
  await f.manager.restore()
  await f.manager.recordRequestEvent('request-error', { url: 'https://user:password@example.com/private-path?token=secret-value#fragment', error: 'net::ERR_PROXY_CONNECTION_FAILED secret-value', statusCode: 502 })
  const data = JSON.stringify(f.manager.getPublicState())
  assert.ok(data.includes('https://example.com'))
  assert.ok(!/password|private-path|secret-value|fragment/.test(data))
})
test('diagnostics use Chromium fetch and cancel the response without direct probes', async () => {
  let called = 0, cancelled = 0
  const diagnostics = new PrivateCloudDiagnostics({ chromiumFetch: async (url, timeout) => { called++; assert.equal(url, 'https://example.com/path?query=private'); assert.equal(timeout, 8000); return { status: 200, body: { cancel: async () => cancelled++ } } } })
  const result = await diagnostics.run('https://example.com/path?query=private', { timeoutMs: 8000 })
  assert.equal(result.ok, true)
  assert.equal(result.target, 'https://example.com')
  assert.equal(called, 1)
  assert.equal(cancelled, 1)
  assert.deepEqual(result.stages.map(stage => stage.name), ['proxy', 'http'])
})
test('diagnostics reject unsupported or credential-bearing URLs before fetching', async () => {
  let called = 0
  const diagnostics = new PrivateCloudDiagnostics({ chromiumFetch: async () => { called++; return { status: 200 } } })
  for (const url of ['file:///private', 'ftp://example.com/', 'https://u:p@example.com/', 'not a URL']) await assert.rejects(diagnostics.run(url))
  assert.equal(called, 0)
})
test('diagnostic errors do not echo URLs, credentials or raw external messages', async () => {
  const diagnostics = new PrivateCloudDiagnostics({ chromiumFetch: async () => { throw new Error('net::ERR_PROXY_CONNECTION_FAILED https://example.com/?token=private-secret') } })
  const result = await diagnostics.run('https://example.com/?token=private-secret')
  assert.equal(result.ok, false)
  assert.equal(result.stages.at(-1).code, 'PROXY_CONNECTION_FAILED')
  assert.ok(!JSON.stringify(result).includes('private-secret'))
})
