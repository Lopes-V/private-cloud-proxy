const assert = require('node:assert/strict')
const http = require('node:http')
const { app, session } = require('electron')
const { NetworkManager } = require('../network/network-manager')
function listen(server) { return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port))) }
function requestText(ses, url) { return ses.fetch(url).then(async response => ({ status: response.status, text: await response.text() })) }
app.whenReady().then(async () => {
  const target = http.createServer((_request, response) => response.end('direct-target'))
  let forwarded = 0
  let targetPort
  const proxy = http.createServer((request, response) => {
    forwarded++
    const url = new URL(request.url)
    const upstream = url.hostname === 'store.steampowered.com'
      ? http.request({ hostname: '127.0.0.1', port: targetPort, path: url.pathname, method: request.method, headers: request.headers }, upstreamResponse => { response.writeHead(upstreamResponse.statusCode, upstreamResponse.headers); upstreamResponse.pipe(response) })
      : http.request(request.url, { method: request.method, headers: request.headers }, upstreamResponse => { response.writeHead(upstreamResponse.statusCode, upstreamResponse.headers); upstreamResponse.pipe(response) })
    upstream.on('error', error => { response.writeHead(502); response.end(error.message) })
    request.pipe(upstream)
  })
  targetPort = await listen(target); const proxyPort = await listen(proxy)
  const ses = session.fromPartition(`network-integration-${process.pid}`); const manager = new NetworkManager({ session: ses, storage: new Map() }); const targetUrl = `http://127.0.0.1:${targetPort}/integration`
  try {
    await manager.apply({ mode: 'direct' }); assert.deepEqual(await requestText(ses, targetUrl), { status: 200, text: 'direct-target' })
    await manager.apply({ mode: 'http', host: '127.0.0.1', port: 19999, bypassRules: '<-loopback>' }); await assert.rejects(requestText(ses, targetUrl))
    await manager.apply({ mode: 'http', host: '127.0.0.1', port: proxyPort, bypassRules: '<-loopback>' }); assert.deepEqual(await requestText(ses, targetUrl), { status: 200, text: 'direct-target' }); assert.equal(forwarded > 0, true); assert.match(await ses.resolveProxy(targetUrl), new RegExp(`PROXY 127\\.0\\.0\\.1:${proxyPort}`)); assert.match(await ses.resolveProxy('https://example.test'), new RegExp(`PROXY 127\\.0\\.0\\.1:${proxyPort}`))
    await manager.apply({ mode: 'http', routing: 'domain', host: '127.0.0.1', port: proxyPort, proxyDomains: 'store.steampowered.com' })
    assert.deepEqual(await requestText(ses, 'http://store.steampowered.com/integration'), { status: 200, text: 'direct-target' })
    assert.match(await ses.resolveProxy('https://store.steampowered.com/'), new RegExp(`PROXY 127\\.0\\.0\\.1:${proxyPort}`))
    assert.equal(await ses.resolveProxy('https://github.com/'), 'DIRECT')
    const forwardedBeforeInvalidRule = forwarded
    await manager.apply({ mode: 'http', routing: 'domain', host: '127.0.0.1', port: 19999, proxyDomains: 'store.steampowered.com' })
    await assert.rejects(requestText(ses, 'http://store.steampowered.com/no-fallback'))
    assert.equal(forwarded, forwardedBeforeInvalidRule)
    const persisted = new Map(); const persistedManager = new NetworkManager({ session: ses, storage: persisted }); await persistedManager.apply({ mode: 'socks5', host: '127.0.0.1', port: 1080 }); const restarted = new NetworkManager({ session: ses, storage: persisted }); await restarted.restore(); assert.equal(restarted.getPublicState().config.mode, 'socks5'); assert.match(await ses.resolveProxy('https://example.test'), /SOCKS5 127\.0\.0\.1:1080/)
    console.log('PASS network integration: direct, invalid proxy, local forwarding, domain PAC without fallback, Chromium HTTP/HTTPS/SOCKS5 rules and persistence')
  } finally { await manager.apply({ mode: 'direct' }).catch(() => {}); await Promise.all([new Promise(resolve => target.close(resolve)), new Promise(resolve => proxy.close(resolve))]); app.quit() }
}).catch(error => { console.error(error); app.exit(1) })
